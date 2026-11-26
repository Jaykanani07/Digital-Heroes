import Stripe from "stripe";
import { env, paymentsMode, siteUrl } from "../config/env.js";
import { query } from "../config/db.js";
import { badRequest, conflict } from "../lib/errors.js";
import { getProduct } from "./catalog.js";
import { markPaid, type OrderRow } from "./orders.js";

/**
 * Per-order checkout (§05) — no subscriptions. Stripe Checkout hosts the
 * card form, so card data never touches our servers (PCI SAQ-A).
 * Without STRIPE_SECRET_KEY the platform runs in clearly labelled TEST
 * PAYMENT mode so every flow can be exercised end to end.
 */
export const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export async function startCheckout(order: OrderRow, customerEmail: string): Promise<{ mode: "stripe" | "test"; url: string | null }> {
  if (order.payment_status !== "unpaid") throw conflict("This order is already paid.");
  if (paymentsMode === "test" || !stripe) return { mode: "test", url: null };

  const product = await getProduct(order.product_id);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: order.order_number },
      payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.order_number } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: order.total_pence,
            product_data: {
              name: `${product.name} × ${order.quantity} — ${order.order_number}`,
              description: `${Math.round(order.config.widthMm)}×${Math.round(order.config.heightMm)} mm, ${order.config.material}. Total includes GST.`,
            },
          },
        },
      ],
      success_url: `${siteUrl}/checkout/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/checkout/${order.id}?cancelled=1`,
    });
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string };
    if (e?.code === "amount_too_small" || /at least 50 cents/i.test(e?.message || "")) {
      throw badRequest("Order total is below Stripe's minimum payment amount (~₹50 / $0.50). Increase quantity or size.");
    }
    if (e?.type === "StripeInvalidRequestError") {
      throw badRequest(e.message || "Payment session could not be started.");
    }
    throw err;
  }
  await query("update orders set stripe_session_id = $2 where id = $1", [order.id, session.id]);
  return { mode: "stripe", url: session.url };
}

/** Verifies a Checkout Session after the redirect (works even without webhooks). */
export async function confirmStripeSession(order: OrderRow, sessionId: string) {
  if (!stripe) throw badRequest("Stripe isn't configured.");
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.orderId !== order.id) throw badRequest("That payment belongs to a different order.");
  if (session.payment_status !== "paid") return null;
  const ref = typeof session.payment_intent === "string" ? session.payment_intent : session.id;
  return markPaid(order.id, ref);
}

/** Stripe webhook: the source of truth when configured. */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) throw badRequest("Webhook not configured.");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature || "", env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw badRequest("Invalid signature.");
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;
    if (orderId && session.payment_status === "paid") {
      const ref = typeof session.payment_intent === "string" ? session.payment_intent : session.id;
      await markPaid(orderId, ref);
    }
  }
}
