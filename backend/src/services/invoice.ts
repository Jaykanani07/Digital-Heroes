import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { one } from "../config/db.js";
import { formatMoney, formatUnit } from "../shared/pricing.js";
import type { OrderRow } from "./orders.js";

/** Downloadable invoice / receipt (§10) for a paid order. */
export async function invoicePdf(order: OrderRow): Promise<Buffer> {
  const info = (await one<{ email: string; full_name: string; company: string | null; product_name: string; division_name: string; materials: { key: string; label: string }[] }>(
    `select u.email, u.full_name, u.company, p.name as product_name, d.name as division_name, p.materials
     from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id join divisions d on d.id = p.division_id
     where o.id = $1`,
    [order.id],
  ))!;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${order.invoice_number}`);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.08);
  const grey = rgb(0.36, 0.37, 0.35);
  const yellow = rgb(0.95, 0.76, 0.19);
  const text = (s: string, x: number, y: number, o: { size?: number; font?: typeof reg; color?: typeof ink } = {}) =>
    page.drawText(s, { x, y, size: o.size ?? 10, font: o.font ?? reg, color: o.color ?? ink });
  const right = (s: string, xr: number, y: number, o: { size?: number; font?: typeof reg } = {}) => {
    const f = o.font ?? reg;
    const size = o.size ?? 10;
    text(s, xr - f.widthOfTextAtSize(s, size), y, o);
  };

  page.drawRectangle({ x: 0, y: 771.89, width: 595.28, height: 70, color: ink });
  text("DIGITAL HEROES", 40, 800, { size: 20, font: bold, color: yellow });
  text("Six print divisions, one press.", 40, 784, { size: 9, color: rgb(0.85, 0.85, 0.83) });
  right(order.payment_status === "paid" ? "PAID" : "UNPAID", 555, 800, { size: 14, font: bold });

  text("Invoice", 40, 730, { size: 22, font: bold });
  const meta: [string, string][] = [
    ["Invoice number", order.invoice_number || "—"],
    ["Order", order.order_number],
    ["Invoice date", new Date(order.paid_at || order.created_at).toLocaleDateString("en-GB")],
    ["Payment", order.payment_status === "paid" ? "Paid by card" : "Awaiting payment"],
  ];
  meta.forEach(([k, v], i) => {
    text(k, 40, 700 - i * 16, { color: grey });
    text(v, 150, 700 - i * 16, { font: bold });
  });
  text("Bill to", 360, 700, { color: grey });
  [info.full_name, info.company || "", info.email].filter(Boolean).forEach((l, i) => text(l, 360, 684 - i * 14));

  let y = 600;
  page.drawLine({ start: { x: 40, y: y + 16 }, end: { x: 555, y: y + 16 }, thickness: 1.5, color: ink });
  text("Description", 40, y, { font: bold });
  right("Qty", 360, y, { font: bold });
  right("Unit (net)", 450, y, { font: bold });
  right("Amount (net)", 555, y, { font: bold });
  y -= 22;
  const c = order.config;
  const material = info.materials.find((m) => m.key === c.material)?.label ?? c.material;
  text(`${info.product_name} (${info.division_name})`, 40, y);
  right(String(order.quantity), 360, y);
  right(formatUnit(order.unit_price_net, order.currency), 450, y);
  right(formatMoney(order.gross_pence, order.currency), 555, y);
  y -= 14;
  text(`${Math.round(c.widthMm)} × ${Math.round(c.heightMm)} mm · ${material} · ${c.orientation}${order.csv_row_count ? ` · ${order.csv_row_count} CSV rows` : ""}`, 40, y, { size: 8.5, color: grey });
  y -= 26;
  page.drawLine({ start: { x: 40, y: y + 12 }, end: { x: 555, y: y + 12 }, thickness: 0.5, color: grey });

  const totals: [string, string, boolean][] = [];
  if (order.discount_pence) totals.push([`Volume discount (${order.discount_pct}%)`, `-${formatMoney(order.discount_pence, order.currency)}`, false]);
  if (order.setup_pence) totals.push(["Setup", formatMoney(order.setup_pence, order.currency), false]);
  totals.push(["Subtotal (net)", formatMoney(order.subtotal_pence, order.currency), false]);
  totals.push([`GST ${Math.round(order.vat_rate * 100)}%`, formatMoney(order.vat_pence, order.currency), false]);
  totals.push(["Total (inc. GST)", formatMoney(order.total_pence, order.currency), true]);
  for (const [k, v, strong] of totals) {
    right(k, 450, y, { font: strong ? bold : reg, size: strong ? 12 : 10 });
    right(v, 555, y, { font: strong ? bold : reg, size: strong ? 12 : 10 });
    y -= strong ? 20 : 16;
  }

  text("Thank you for your order.", 40, 120, { font: bold });
  text("Digital Heroes · digitalheroes.co.in · GST registered", 40, 104, { size: 8.5, color: grey });
  text(`Generated ${new Date().toLocaleString("en-GB")}`, 40, 90, { size: 8.5, color: grey });
  return Buffer.from(await pdf.save());
}
