import { ZipArchive } from "archiver";
import { env } from "../config/env.js";
import { one, pool, query, tx, type Queryable } from "../config/db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { calculateQuote, formatMoney, validateConfig, type ProductConfig } from "../shared/pricing.js";
import { boundColumns, fitText, validateDesign, type Design, type TextElement } from "../shared/design.js";
import { getProduct, getTiers, type ProductRow } from "./catalog.js";
import { getAssetFor, loadCsvRows, loadDesignImages } from "./assets.js";
import { designToPdf, designToPng, measureMm } from "./render.js";
import { putFile, removeFiles } from "./storage.js";
import { notifyAdmin, sendMail } from "./email.js";

export const STATUSES = ["quote", "order", "artwork", "proof", "production", "completed"] as const;
export type OrderStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  quote: "Quote",
  order: "Order placed",
  artwork: "Artwork",
  proof: "Proof",
  production: "In production",
  completed: "Completed",
};

export interface OrderRow {
  id: string;
  order_number: string;
  user_id: string;
  product_id: string;
  design_id: string | null;
  status: OrderStatus;
  payment_status: "unpaid" | "paid" | "refunded";
  config: ProductConfig;
  design_snapshot: Design | null;
  artwork_asset_id: string | null;
  csv_asset_id: string | null;
  csv_row_count: number | null;
  quantity: number;
  unit_price_net: number;
  discount_pct: number;
  gross_pence: number;
  discount_pence: number;
  setup_pence: number;
  subtotal_pence: number;
  vat_rate: number;
  vat_pence: number;
  total_pence: number;
  currency: string;
  stripe_session_id: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  files_ready: boolean;
  archived: boolean;
  reorder_of: string | null;
  customer_note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProofRow {
  id: string;
  order_id: string;
  version: number;
  status: "pending" | "approved" | "changes_requested" | "superseded";
  source: string;
  design_snapshot: Design | null;
  preview_path: string | null;
  pdf_path: string | null;
  fit_report: unknown[];
  customer_note: string | null;
  created_at: string;
  decided_at: string | null;
}

// ------------------------------------------------------------- helpers

export async function getOrder(id: string, db: Queryable = pool): Promise<OrderRow> {
  const o = await one<OrderRow>("select * from orders where id = $1", [id], db);
  if (!o) throw notFound("Order not found.");
  return o;
}

/** Customers can only reach their own orders; admins reach all. */
export async function getOrderFor(user: AuthUser, id: string): Promise<OrderRow> {
  const o = await getOrder(id);
  if (user.role !== "admin" && o.user_id !== user.id) throw notFound("Order not found.");
  return o;
}

async function setStatus(db: Queryable, order: OrderRow, to: OrderStatus, actorId: string | null, note: string | null) {
  if (order.status === to) return;
  await db.query(
    `update orders set status = $2::order_status,
       completed_at = case when $2::text = 'completed' then now() else completed_at end
     where id = $1`,
    [order.id, to],
  );
  await db.query(
    "insert into order_status_history (order_id, from_status, to_status, actor_id, note) values ($1, $2, $3, $4, $5)",
    [order.id, order.status, to, actorId, note],
  );
  order.status = to;
}

/** File naming convention (§07): OrderID_ProductType_Date_Output */
function fileStem(order: OrderRow, product: ProductRow) {
  const date = new Date().toISOString().slice(0, 10);
  return `${order.order_number}_${product.slug}_${date}`;
}

async function customerOf(order: OrderRow) {
  return (await one<{ email: string; full_name: string }>("select email, full_name from users where id = $1", [order.user_id]))!;
}

/** A design built around a single uploaded artwork file filling the trim. */
export function artworkDesign(widthMm: number, heightMm: number, assetId: string): Design {
  return {
    version: 1,
    widthMm,
    heightMm,
    background: "#FFFFFF",
    elements: [{ id: "artwork", type: "image", assetId, fit: "contain", isArtwork: true, x: 0, y: 0, w: widthMm, h: heightMm, rotation: 0, name: "Uploaded artwork" }],
  };
}

/** Every image in a customer design must be one of that customer's uploads. */
async function assertImagesOwned(design: Design, userId: string) {
  const ids = [...new Set(design.elements.filter((e) => e.type === "image").map((e) => (e as { assetId: string }).assetId))];
  if (!ids.length) return;
  const rows = await query<{ id: string; owner_id: string; png_path: string | null }>(
    "select id, owner_id, png_path from assets where id = any($1::uuid[])",
    [ids],
  );
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.png_path) throw badRequest("An image in your design is missing. Remove it and upload it again.");
    if (r.owner_id !== userId) throw forbidden("An image in your design belongs to another account.");
  }
}

export interface ArtworkInput {
  design?: Design | null;
  artworkAssetId?: string | null;
}

/**
 * Resolves and validates the artwork for an order: either an in-browser
 * design or an uploaded file. Guarantees nothing unprintable gets through.
 */
async function resolveArtwork(
  user: AuthUser,
  ownerId: string,
  product: ProductRow,
  config: ProductConfig,
  input: ArtworkInput,
  rows: Record<string, string>[] | null,
  csvColumns: string[] | null,
): Promise<{ design: Design; artworkAssetId: string | null }> {
  let design: Design;
  let artworkAssetId: string | null = null;
  if (input.artworkAssetId) {
    const asset = await getAssetFor(user, input.artworkAssetId);
    if (asset.kind !== "artwork") throw badRequest("That file isn't an artwork upload.");
    if (user.role !== "admin" && asset.owner_id !== ownerId) throw forbidden();
    design = artworkDesign(config.widthMm, config.heightMm, asset.id);
    artworkAssetId = asset.id;
  } else if (input.design) {
    design = input.design;
    if (Math.abs(design.widthMm - config.widthMm) > 0.5 || Math.abs(design.heightMm - config.heightMm) > 0.5) {
      throw badRequest("The design size doesn't match the configured product size. Reopen the designer to update it.");
    }
    design = { ...design, widthMm: config.widthMm, heightMm: config.heightMm };
    await assertImagesOwned(design, ownerId);
  } else {
    throw badRequest("Add artwork: design it in the browser or upload a finished file.");
  }

  if (rows) {
    const cols = boundColumns(design);
    if (!cols.length) throw badRequest("Link at least one text box to a CSV column so each row gets its own artwork.");
    const missing = cols.filter((c) => !csvColumns?.includes(c));
    if (missing.length) throw badRequest(`The CSV has no column named "${missing[0]}".`);
  }
  const issues = validateDesign(design, product.print_spec, measureMm, rows);
  if (issues.length) throw badRequest(issues[0].message, { issues });
  return { design, artworkAssetId };
}

// ------------------------------------------------------- create (quote)

export interface CreateOrderInput extends ArtworkInput {
  productId: string;
  config: ProductConfig;
  csvAssetId?: string | null;
  designId?: string | null;
  note?: string | null;
}

/** Creates a priced order in the QUOTE stage (awaiting payment). */
export async function createOrder(user: AuthUser, input: CreateOrderInput): Promise<OrderRow> {
  const product = await getProduct(input.productId);
  if (!product.is_active) throw badRequest("This product isn't available right now.");
  const config: ProductConfig = { ...input.config };

  let rows: Record<string, string>[] | null = null;
  let columns: string[] | null = null;
  if (input.csvAssetId) {
    if (!product.supports_csv) throw badRequest("This product doesn't support CSV variable data.");
    const asset = await getAssetFor(user, input.csvAssetId);
    if (asset.kind !== "csv") throw badRequest("That file isn't a CSV upload.");
    const parsed = await loadCsvRows(asset.id);
    rows = parsed.rows;
    columns = parsed.columns;
    config.quantity = rows.length; // one printed item per CSV row
  }

  const configErrors = validateConfig(product, config);
  if (configErrors.length) {
    const msg = rows ? `Your CSV has ${rows.length} rows. ${configErrors[0]}` : configErrors[0];
    throw badRequest(msg, { errors: configErrors });
  }

  if (input.designId) {
    const d = await one("select id from designs where id = $1 and user_id = $2", [input.designId, user.id]);
    if (!d) throw notFound("Saved design not found.");
  }

  const { design, artworkAssetId } = await resolveArtwork(user, user.id, product, config, input, rows, columns);
  const tiers = await getTiers(product.id);
  const q = calculateQuote(product, tiers, config, env.VAT_RATE);

  return tx(async (c) => {
    const order = (await one<OrderRow>(
      `insert into orders (user_id, product_id, design_id, status, config, design_snapshot, artwork_asset_id, csv_asset_id,
         csv_row_count, quantity, unit_price_net, discount_pct, gross_pence, discount_pence, setup_pence, subtotal_pence,
         vat_rate, vat_pence, total_pence, currency, customer_note)
       values ($1,$2,$3,'quote',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
      [
        user.id, product.id, input.designId ?? null, config, design, artworkAssetId, input.csvAssetId ?? null,
        rows ? rows.length : null, q.quantity, q.unitNet, q.discountPct, q.grossPence, q.discountPence, q.setupPence,
        q.subtotalPence, q.vatRate, q.vatPence, q.totalPence, env.CURRENCY, input.note?.slice(0, 1000) ?? null,
      ],
      c,
    ))!;
    await c.query(
      "insert into order_status_history (order_id, from_status, to_status, actor_id, note) values ($1, null, 'quote', $2, 'Quote created')",
      [order.id, user.id],
    );
    return order;
  });
}

/** Customers may delete an unpaid quote they no longer want. */
export async function deleteQuote(user: AuthUser, orderId: string) {
  const o = await getOrderFor(user, orderId);
  if (o.payment_status !== "unpaid" || o.status !== "quote") throw conflict("Only unpaid quotes can be removed.");
  await query("delete from orders where id = $1", [o.id]);
}

// ------------------------------------------------------------- payment

/** Idempotent: called by the Stripe webhook, the success redirect and test mode. */
export async function markPaid(orderId: string, paymentRef: string): Promise<OrderRow | null> {
  const order = await tx(async (c) => {
    const o = await one<OrderRow>(
      `update orders set payment_status = 'paid', paid_at = now(), stripe_payment_ref = $2,
         invoice_number = 'INV-' || nextval('invoice_number_seq')
       where id = $1 and payment_status = 'unpaid' returning *`,
      [orderId, paymentRef],
      c,
    );
    if (!o) return null;
    await setStatus(c, o, "order", null, `Payment received (${paymentRef})`);
    return o;
  });
  if (!order) return null; // already processed

  const customer = await customerOf(order);
  const product = await getProduct(order.product_id);
  await sendMail({
    to: customer.email,
    userId: order.user_id,
    orderId: order.id,
    subject: `Order ${order.order_number} confirmed`,
    lines: [
      `Hi ${customer.full_name},`,
      `Thanks for your order. We've received ${formatMoney(order.total_pence, order.currency)} for ${order.quantity} × ${product.name}.`,
      order.reorder_of ? "This is a reorder of approved artwork, so it goes straight to production." : "We're preparing your proof now. You'll get an e-mail as soon as it's ready to approve.",
    ],
    cta: { label: "View your order", path: `/account/orders/${order.id}` },
  });
  await notifyAdmin(`New paid order ${order.order_number}`, [`${order.quantity} × ${product.name}`, `Total ${formatMoney(order.total_pence)}`], order.id, `/admin/orders/${order.id}`);

  await afterPayment(order);
  return getOrder(order.id);
}

/** Moves a freshly paid order into ARTWORK and issues proof v1 (or auto-approves a reorder). */
async function afterPayment(order: OrderRow) {
  try {
    if (order.reorder_of) {
      const prev = await one<ProofRow>(
        "select * from proofs where order_id = $1 and status = 'approved' order by version desc limit 1",
        [order.reorder_of],
      );
      const original = await getOrder(order.reorder_of);
      if (prev) {
        await issueProof(order.id, {
          source: "reorder",
          actorId: null,
          autoApproveNote: `Re-ordered from ${original.order_number}, whose proof v${prev.version} was approved.`,
        });
        return;
      }
    }
    await tx(async (c) => setStatus(c, order, "artwork", null, "Artwork received"));
    await issueProof(order.id, { source: order.artwork_asset_id ? "upload" : "designer", actorId: null });
  } catch (e) {
    console.error(`[orders] automatic proof for ${order.order_number} failed:`, e);
    await notifyAdmin(`Proof generation failed for ${order.order_number}`, ["Open the job and use “Generate proof”."], order.id, `/admin/orders/${order.id}`);
  }
}

// --------------------------------------------------------------- proofs

interface IssueProofOptions {
  source: "designer" | "upload" | "admin_upload" | "reorder";
  actorId: string | null;
  /** Replace the order's artwork with this design before proofing. */
  design?: Design;
  artworkAssetId?: string | null;
  /** Reorders of approved artwork skip the approval step (logged). */
  autoApproveNote?: string;
}

/** Renders a new proof version (PNG with guides + proof PDF) and puts the order in PROOF. */
export async function issueProof(orderId: string, opts: IssueProofOptions): Promise<ProofRow> {
  const order = await getOrder(orderId);
  if (order.payment_status !== "paid") throw conflict("Proofs are issued after payment.");
  if (!opts.autoApproveNote && !["order", "artwork", "proof"].includes(order.status)) {
    throw conflict("Proofs can only be issued before the job goes into production.");
  }
  const product = await getProduct(order.product_id);
  const design = opts.design ?? order.design_snapshot;
  if (!design) throw badRequest("This order has no artwork yet.");

  const images = await loadDesignImages(design, null);
  const rows = order.csv_asset_id ? (await loadCsvRows(order.csv_asset_id)).rows : null;
  const spec = product.print_spec;
  const stem = fileStem(order, product);

  const versionRow = await one<{ v: number }>("select coalesce(max(version), 0) + 1 as v from proofs where order_id = $1", [order.id]);
  const version = versionRow!.v;

  const png = await designToPng(design, spec, { images, row: rows?.[0] ?? null, guides: true, dpi: 150, maxPx: 1800 });
  const pdf = await designToPdf(design, spec, { images, rows: rows ? rows.slice(0, 3) : null, title: `${order.order_number} proof v${version}` });
  const dir = `orders/${order.order_number}/proofs`;
  const previewPath = await putFile(`${dir}/${stem}_proof-v${version}.png`, png, "image/png");
  const pdfPath = await putFile(`${dir}/${stem}_proof-v${version}.pdf`, pdf, "application/pdf");

  const fitReport = design.elements
    .filter((e): e is TextElement => e.type === "text")
    .map((el) => {
      const f = fitText(el, measureMm, rows?.[0] ?? null);
      return { elementId: el.id, name: el.name || el.text.slice(0, 24), fontSize: f.fontSize, tracking: f.tracking, shrunk: f.fontSize < el.fontSize || f.tracking < el.tracking };
    });

  const auto = Boolean(opts.autoApproveNote);
  const artId = opts.artworkAssetId !== undefined ? opts.artworkAssetId : order.artwork_asset_id;
  const proof = await tx(async (c) => {
    if (opts.design || opts.artworkAssetId !== undefined) {
      await c.query("update orders set design_snapshot = $2, artwork_asset_id = $3 where id = $1", [order.id, design, artId]);
    }
    await c.query("update proofs set status = 'superseded' where order_id = $1 and status = 'pending'", [order.id]);
    const p = (await one<ProofRow>(
      `insert into proofs (order_id, version, status, source, design_snapshot, artwork_asset_id, preview_path, pdf_path, fit_report, created_by, decided_at)
       values ($1,$2,$3::proof_status,$4,$5,$6,$7,$8,$9,$10, case when $3::text = 'approved' then now() else null end) returning *`,
      [order.id, version, auto ? "approved" : "pending", opts.source, design, artId, previewPath, pdfPath, JSON.stringify(fitReport), opts.actorId],
      c,
    ))!;
    await c.query("insert into approval_logs (order_id, proof_id, version, action, actor_id, note) values ($1,$2,$3,'issued',$4,$5)", [
      order.id, p.id, version, opts.actorId, `Proof v${version} issued (${opts.source})`,
    ]);
    if (auto) {
      await c.query("insert into approval_logs (order_id, proof_id, version, action, actor_email, note) values ($1,$2,$3,'auto_approved','system',$4)", [
        order.id, p.id, version, opts.autoApproveNote,
      ]);
      if (order.status === "order") await setStatus(c, order, "artwork", null, "Approved artwork reused");
      await setStatus(c, order, "production", null, "Approved artwork reused — sent to production");
    } else {
      await setStatus(c, order, "proof", opts.actorId, `Proof v${version} issued`);
    }
    return p;
  });

  const customer = await customerOf(order);
  if (auto) {
    await generatePrintFiles(order.id);
    await sendMail({
      to: customer.email,
      userId: order.user_id,
      orderId: order.id,
      subject: `${order.order_number} is in production`,
      lines: [`Hi ${customer.full_name},`, "Your reorder uses artwork you already approved, so it's gone straight to production."],
      cta: { label: "Track your order", path: `/account/orders/${order.id}` },
    });
  } else {
    await sendMail({
      to: customer.email,
      userId: order.user_id,
      orderId: order.id,
      subject: `Proof v${version} ready for ${order.order_number}`,
      lines: [`Hi ${customer.full_name},`, `Proof v${version} of your ${product.name} is ready. Check it carefully, then approve it or ask for changes.`, "Nothing is printed until you approve."],
      cta: { label: "Review proof", path: `/account/orders/${order.id}` },
    });
  }
  return proof;
}

async function latestProof(orderId: string) {
  return one<ProofRow>("select * from proofs where order_id = $1 order by version desc limit 1", [orderId]);
}

/** Customer approves the latest pending proof → PRODUCTION, print files unlocked. */
export async function approveProof(user: AuthUser, orderId: string, proofId: string, ip: string | null) {
  const order = await getOrderFor(user, orderId);
  if (order.status !== "proof") throw conflict("There's no proof waiting for approval on this order.");
  const proof = await latestProof(order.id);
  if (!proof || proof.id !== proofId) throw conflict("A newer proof exists. Review the latest version.");
  if (proof.status !== "pending") throw conflict("This proof has already been decided.");

  await tx(async (c) => {
    await c.query("update proofs set status = 'approved', decided_by = $2, decided_at = now() where id = $1", [proof.id, user.id]);
    await c.query(
      "insert into approval_logs (order_id, proof_id, version, action, actor_id, actor_email, ip, note) values ($1,$2,$3,'approved',$4,$5,$6,$7)",
      [order.id, proof.id, proof.version, user.id, user.email, ip, `Proof v${proof.version} approved`],
    );
    await setStatus(c, order, "production", user.id, `Proof v${proof.version} approved`);
  });

  // Saved designs (§09): approved artwork is stored against the account for reuse.
  await saveApprovedDesign(order, proof);
  await generatePrintFiles(order.id);

  const customer = await customerOf(order);
  await sendMail({
    to: customer.email,
    userId: order.user_id,
    orderId: order.id,
    subject: `${order.order_number}: proof approved, now in production`,
    lines: [`Hi ${customer.full_name},`, `Thanks for approving proof v${proof.version}. Your job is now in production.`],
    cta: { label: "Track your order", path: `/account/orders/${order.id}` },
  });
  await notifyAdmin(`${order.order_number}: proof v${proof.version} approved`, ["Print files are ready to download."], order.id, `/admin/orders/${order.id}`);
}

async function saveApprovedDesign(order: OrderRow, proof: ProofRow) {
  const product = await getProduct(order.product_id);
  if (order.design_id) {
    await query("update designs set design = $2, config = $3, artwork_asset_id = $4, csv_asset_id = $5 where id = $1 and user_id = $6", [
      order.design_id, proof.design_snapshot, order.config, order.artwork_asset_id, order.csv_asset_id, order.user_id,
    ]);
  } else {
    const d = await one<{ id: string }>(
      `insert into designs (user_id, product_id, name, config, design, artwork_asset_id, csv_asset_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [order.user_id, order.product_id, `${product.name} — ${order.order_number}`, order.config, proof.design_snapshot, order.artwork_asset_id, order.csv_asset_id],
    );
    await query("update orders set design_id = $2 where id = $1", [order.id, d!.id]);
  }
}

/** Customer asks for changes → back to ARTWORK. */
export async function requestChanges(user: AuthUser, orderId: string, proofId: string, note: string, ip: string | null) {
  const order = await getOrderFor(user, orderId);
  if (order.status !== "proof") throw conflict("There's no proof waiting for a decision.");
  const proof = await latestProof(order.id);
  if (!proof || proof.id !== proofId) throw conflict("A newer proof exists. Review the latest version.");
  if (proof.status !== "pending") throw conflict("This proof has already been decided.");
  await tx(async (c) => {
    await c.query("update proofs set status = 'changes_requested', customer_note = $2, decided_by = $3, decided_at = now() where id = $1", [proof.id, note, user.id]);
    await c.query(
      "insert into approval_logs (order_id, proof_id, version, action, actor_id, actor_email, ip, note) values ($1,$2,$3,'changes_requested',$4,$5,$6,$7)",
      [order.id, proof.id, proof.version, user.id, user.email, ip, note],
    );
    await setStatus(c, order, "artwork", user.id, `Changes requested on v${proof.version}`);
  });
  await notifyAdmin(`${order.order_number}: changes requested on proof v${proof.version}`, [note], order.id, `/admin/orders/${order.id}`);
}

/** Customer (or admin) supplies revised artwork while the order is in ARTWORK → new proof version. */
export async function resubmitArtwork(user: AuthUser, orderId: string, input: ArtworkInput) {
  const order = await getOrderFor(user, orderId);
  if (order.payment_status !== "paid") throw conflict("Pay for the order first.");
  if (order.status !== "artwork") throw conflict("Artwork can only be changed while the order is waiting for artwork.");
  const product = await getProduct(order.product_id);
  const rows = order.csv_asset_id ? await loadCsvRows(order.csv_asset_id) : null;
  const { design, artworkAssetId } = await resolveArtwork(user, order.user_id, product, order.config, input, rows?.rows ?? null, rows?.columns ?? null);
  return issueProof(order.id, {
    source: user.role === "admin" ? "admin_upload" : artworkAssetId ? "upload" : "designer",
    actorId: user.id,
    design,
    artworkAssetId,
  });
}

// ---------------------------------------------------------- print files

async function zipBuffers(files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });
  for (const f of files) archive.append(f.data, { name: f.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

/**
 * Generates production files from the APPROVED proof (approval gate, §08).
 * Single artwork: high-res PDF (vector, bleed, trim box) + PNG at product DPI.
 * CSV jobs: one PDF per row (zipped) + a combined multi-page PDF.
 */
export async function generatePrintFiles(orderId: string) {
  const order = await getOrder(orderId);
  const proof = await one<ProofRow>(
    "select * from proofs where order_id = $1 and status = 'approved' order by version desc limit 1",
    [order.id],
  );
  if (!proof || !proof.design_snapshot) throw conflict("Print files unlock only after a proof is approved.");
  const product = await getProduct(order.product_id);
  const spec = product.print_spec;
  const design = proof.design_snapshot;
  const images = await loadDesignImages(design, null);
  const stem = fileStem(order, product);
  const dir = `orders/${order.order_number}/print`;
  const created: { kind: string; filename: string; path: string; size: number; rows: number | null }[] = [];

  if (order.csv_asset_id) {
    const { rows } = await loadCsvRows(order.csv_asset_id);
    const all = await designToPdf(design, spec, { images, rows, title: `${order.order_number} — all rows` });
    const allName = `${stem}_print-all-rows.pdf`;
    created.push({ kind: "csv_pdf", filename: allName, path: await putFile(`${dir}/${allName}`, all, "application/pdf"), size: all.length, rows: rows.length });
    const perRow: { name: string; data: Buffer }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const data = await designToPdf(design, spec, { images, rows: [rows[i]], title: `${order.order_number} row ${i + 1}` });
      perRow.push({ name: `${stem}_row-${String(i + 1).padStart(4, "0")}.pdf`, data });
    }
    const zip = await zipBuffers(perRow);
    const zipName = `${stem}_rows.zip`;
    created.push({ kind: "csv_zip", filename: zipName, path: await putFile(`${dir}/${zipName}`, zip, "application/zip"), size: zip.length, rows: rows.length });
  } else {
    const pdf = await designToPdf(design, spec, { images, title: `${order.order_number} print file` });
    const pdfName = `${stem}_print.pdf`;
    created.push({ kind: "print_pdf", filename: pdfName, path: await putFile(`${dir}/${pdfName}`, pdf, "application/pdf"), size: pdf.length, rows: null });
    const png = await designToPng(design, spec, { images, dpi: spec.dpi, maxPx: 12000 });
    const pngName = `${stem}_print.png`;
    created.push({ kind: "print_png", filename: pngName, path: await putFile(`${dir}/${pngName}`, png, "image/png"), size: png.length, rows: null });
  }

  const old = await query<{ storage_path: string }>("select storage_path from print_files where order_id = $1", [order.id]);
  await tx(async (c) => {
    await c.query("delete from print_files where order_id = $1", [order.id]);
    for (const f of created) {
      await c.query("insert into print_files (order_id, proof_id, kind, filename, storage_path, size_bytes, rows) values ($1,$2,$3,$4,$5,$6,$7)", [
        order.id, proof.id, f.kind, f.filename, f.path, f.size, f.rows,
      ]);
    }
    await c.query("update orders set files_ready = true where id = $1", [order.id]);
  });
  const stale = old.map((o) => o.storage_path).filter((p) => !created.some((f) => f.path === p));
  await removeFiles(stale).catch(() => undefined);
}

// ------------------------------------------------------------- reorder

/** One-click reorder (§09): a new quote reusing the approved artwork. */
export async function reorder(user: AuthUser, orderId: string): Promise<OrderRow> {
  const prev = await getOrderFor(user, orderId);
  if (prev.payment_status !== "paid") throw conflict("Only paid orders can be reordered.");
  const approved = await one<ProofRow>(
    "select * from proofs where order_id = $1 and status = 'approved' order by version desc limit 1",
    [prev.id],
  );
  const design = approved?.design_snapshot ?? prev.design_snapshot;
  if (!design) throw conflict("This order has no artwork to reuse.");
  const product = await getProduct(prev.product_id);
  if (!product.is_active) throw conflict("This product is no longer available.");
  const configErrors = validateConfig(product, prev.config);
  if (configErrors.length) throw conflict(`This configuration is no longer available: ${configErrors[0]}`);
  const tiers = await getTiers(product.id);
  const q = calculateQuote(product, tiers, prev.config, env.VAT_RATE);

  return tx(async (c) => {
    const order = (await one<OrderRow>(
      `insert into orders (user_id, product_id, design_id, status, config, design_snapshot, artwork_asset_id, csv_asset_id,
         csv_row_count, quantity, unit_price_net, discount_pct, gross_pence, discount_pence, setup_pence, subtotal_pence,
         vat_rate, vat_pence, total_pence, currency, reorder_of)
       values ($1,$2,$3,'quote',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
      [
        prev.user_id, prev.product_id, prev.design_id, prev.config, design, prev.artwork_asset_id, prev.csv_asset_id,
        prev.csv_row_count, q.quantity, q.unitNet, q.discountPct, q.grossPence, q.discountPence, q.setupPence,
        q.subtotalPence, q.vatRate, q.vatPence, q.totalPence, env.CURRENCY, approved ? prev.id : null,
      ],
      c,
    ))!;
    await c.query(
      "insert into order_status_history (order_id, from_status, to_status, actor_id, note) values ($1, null, 'quote', $2, $3)",
      [order.id, user.id, `Reorder of ${prev.order_number}`],
    );
    return order;
  });
}

// --------------------------------------------------- admin pipeline moves

/** Admin moves a job along the pipeline, with guard rails. */
export async function adminSetStatus(admin: AuthUser, orderId: string, to: OrderStatus, note: string | null) {
  const order = await getOrder(orderId);
  if (order.status === to) throw conflict(`The job is already in ${STATUS_LABEL[to]}.`);
  if (to !== "quote" && order.payment_status !== "paid") throw conflict("This job hasn't been paid yet.");
  if (to === "quote" && order.payment_status === "paid") throw conflict("A paid job can't go back to quote.");
  if (to === "proof") {
    const p = await latestProof(order.id);
    if (!p || p.status !== "pending") throw conflict("There's no pending proof. Use “Generate proof” first.");
  }
  if ((to === "production" || to === "completed") && !order.files_ready) {
    throw conflict("Files are locked until the customer approves a proof.");
  }
  await tx(async (c) => setStatus(c, order, to, admin.id, note || `Moved to ${STATUS_LABEL[to]} by admin`));

  const customer = await customerOf(order);
  await sendMail({
    to: customer.email,
    userId: order.user_id,
    orderId: order.id,
    subject: to === "completed" ? `${order.order_number} is complete` : `${order.order_number}: ${STATUS_LABEL[to]}`,
    lines:
      to === "completed"
        ? [`Hi ${customer.full_name},`, "Your job is complete and on its way. Thanks for printing with Digital Heroes.", "You can reorder it in one click from your account."]
        : [`Hi ${customer.full_name},`, `Your order ${order.order_number} is now at: ${STATUS_LABEL[to]}.`, ...(note ? [note] : [])],
    cta: { label: "View order", path: `/account/orders/${order.id}` },
  });
  return getOrder(order.id);
}
