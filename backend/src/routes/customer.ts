import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { one, query } from "../config/db.js";
import { ah, badRequest, conflict, notFound, parse } from "../lib/errors.js";
import { configSchema, designSchema, uuid } from "../lib/schemas.js";
import { requireAuth } from "../middleware/auth.js";
import { getAssetFor, loadCsvRows, loadDesignImages, storeUpload } from "../services/assets.js";
import { getProduct } from "../services/catalog.js";
import { designToPng, measureMm } from "../services/render.js";
import { getFile, putFile } from "../services/storage.js";
import {
  approveProof,
  createOrder,
  deleteQuote,
  getOrderFor,
  markPaid,
  reorder,
  requestChanges,
  resubmitArtwork,
} from "../services/orders.js";
import { confirmStripeSession, startCheckout } from "../services/payments.js";
import { invoicePdf } from "../services/invoice.js";
import { paymentsMode } from "../config/env.js";
import { validateDesign, type Design } from "../shared/design.js";

export const customerRouter = Router();
customerRouter.use(requireAuth);

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || null)?.slice(0, 64) ?? null;

// ---------------------------------------------------------------- assets

customerRouter.post(
  "/assets",
  upload.single("file"),
  ah(async (req, res) => {
    const kind = parse(z.enum(["logo", "artwork", "csv"]), req.body?.kind);
    if (!req.file) throw badRequest("Choose a file to upload.");
    const { asset, csv } = await storeUpload(req.user!, kind, req.file);
    res.status(201).json({
      id: asset.id,
      kind: asset.kind,
      originalName: asset.original_name,
      mime: asset.mime,
      width: asset.width_px,
      height: asset.height_px,
      meta: asset.meta,
      csv: csv ? { columns: csv.columns, rowCount: csv.rows.length, rows: csv.rows.slice(0, 200) } : undefined,
    });
  }),
);

/** Streams an asset: the PNG render by default, the original with ?original=1. */
customerRouter.get(
  "/assets/:id/file",
  ah(async (req, res) => {
    const a = await getAssetFor(req.user!, String(req.params.id));
    const original = req.query.original === "1" || !a.png_path;
    const buf = await getFile(original ? a.storage_path : a.png_path!);
    res.setHeader("Content-Type", original ? a.mime : "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (original) res.setHeader("Content-Disposition", `attachment; filename="${a.original_name.replace(/"/g, "")}"`);
    res.send(buf);
  }),
);

customerRouter.get(
  "/assets/:id/csv",
  ah(async (req, res) => {
    const a = await getAssetFor(req.user!, String(req.params.id));
    if (a.kind !== "csv") throw badRequest("Not a CSV file.");
    const parsed = await loadCsvRows(a.id);
    res.json({ id: a.id, originalName: a.original_name, columns: parsed.columns, rowCount: parsed.rows.length, rows: parsed.rows.slice(0, 200) });
  }),
);

/**
 * Server-rendered proof preview of a design in progress — exactly what the
 * print engine will produce, with trim and safe-area guides.
 */
customerRouter.post(
  "/preview",
  ah(async (req, res) => {
    const body = parse(z.object({ productId: z.string().min(1), design: designSchema, csvAssetId: uuid.nullable().optional(), rowIndex: z.number().int().min(0).optional() }), req.body);
    const product = await getProduct(body.productId);
    const images = await loadDesignImages(body.design, req.user!.role === "admin" ? null : req.user!.id);
    let row: Record<string, string> | null = null;
    if (body.csvAssetId) {
      await getAssetFor(req.user!, body.csvAssetId);
      const { rows } = await loadCsvRows(body.csvAssetId);
      row = rows[Math.min(body.rowIndex ?? 0, rows.length - 1)] ?? null;
    }
    const issues = validateDesign(body.design, product.print_spec, measureMm, row ? [row] : null);
    const png = await designToPng(body.design, product.print_spec, { images, row, guides: true, dpi: 150, maxPx: 1400 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Design-Issues", encodeURIComponent(JSON.stringify(issues)));
    res.send(png);
  }),
);

// --------------------------------------------------------------- designs

const designBody = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1, "Name your design").max(120),
  config: configSchema,
  design: designSchema.nullable().optional(),
  artworkAssetId: uuid.nullable().optional(),
  csvAssetId: uuid.nullable().optional(),
});

async function designThumbnail(userId: string, designId: string, productId: string, design: Design | null) {
  if (!design) return null;
  try {
    const product = await getProduct(productId);
    const images = await loadDesignImages(design, null);
    const png = await designToPng(design, product.print_spec, { images, bleed: false, dpi: 72, maxPx: 480 });
    return await putFile(`designs/${userId}/${designId}/thumb.png`, png, "image/png");
  } catch (e) {
    console.error("[designs] thumbnail failed", e);
    return null;
  }
}

async function checkDesignAssets(req: Request, body: z.infer<typeof designBody>) {
  const product = await getProduct(body.productId);
  for (const id of [body.artworkAssetId, body.csvAssetId]) if (id) await getAssetFor(req.user!, id);
  if (body.design) await loadDesignImages(body.design, req.user!.id); // ownership check
  if (!body.design && !body.artworkAssetId) throw badRequest("Nothing to save yet — add a design or upload artwork.");
  return product;
}

customerRouter.get(
  "/designs",
  ah(async (req, res) => {
    const rows = await query(
      `select ds.id, ds.name, ds.config, ds.product_id, ds.artwork_asset_id, ds.csv_asset_id, ds.thumbnail_path is not null as has_thumbnail,
              ds.created_at, ds.updated_at, p.name as product_name, p.slug as product_slug, d.name as division_name,
              (select count(*) from orders o where o.design_id = ds.id and o.payment_status = 'paid') as times_ordered
       from designs ds join products p on p.id = ds.product_id join divisions d on d.id = p.division_id
       where ds.user_id = $1 order by ds.updated_at desc`,
      [req.user!.id],
    );
    res.json(rows);
  }),
);

customerRouter.get(
  "/designs/:id",
  ah(async (req, res) => {
    const d = await one(
      `select ds.*, p.slug as product_slug, p.name as product_name from designs ds join products p on p.id = ds.product_id
       where ds.id = $1 and ds.user_id = $2`,
      [req.params.id, req.user!.id],
    );
    if (!d) throw notFound("Design not found.");
    res.json(d);
  }),
);

customerRouter.get(
  "/designs/:id/thumbnail",
  ah(async (req, res) => {
    const d = await one<{ thumbnail_path: string | null }>("select thumbnail_path from designs where id = $1 and user_id = $2", [req.params.id, req.user!.id]);
    if (!d?.thumbnail_path) throw notFound();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(await getFile(d.thumbnail_path));
  }),
);

customerRouter.post(
  "/designs",
  ah(async (req, res) => {
    const body = parse(designBody, req.body);
    const product = await checkDesignAssets(req, body);
    const d = (await one(
      `insert into designs (user_id, product_id, name, config, design, artwork_asset_id, csv_asset_id) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.user!.id, product.id, body.name, body.config, body.design ?? null, body.artworkAssetId ?? null, body.csvAssetId ?? null],
    ))!;
    const thumb = await designThumbnail(req.user!.id, d.id, product.id, body.design ?? null);
    if (thumb) await query("update designs set thumbnail_path = $2 where id = $1", [d.id, thumb]);
    res.status(201).json({ ...d, thumbnail_path: thumb });
  }),
);

customerRouter.put(
  "/designs/:id",
  ah(async (req, res) => {
    const body = parse(designBody, req.body);
    const existing = await one("select id from designs where id = $1 and user_id = $2", [req.params.id, req.user!.id]);
    if (!existing) throw notFound("Design not found.");
    const product = await checkDesignAssets(req, body);
    const thumb = await designThumbnail(req.user!.id, existing.id, product.id, body.design ?? null);
    const d = await one(
      `update designs set product_id = $2, name = $3, config = $4, design = $5, artwork_asset_id = $6, csv_asset_id = $7, thumbnail_path = $8
       where id = $1 returning *`,
      [existing.id, product.id, body.name, body.config, body.design ?? null, body.artworkAssetId ?? null, body.csvAssetId ?? null, thumb],
    );
    res.json(d);
  }),
);

customerRouter.patch(
  "/designs/:id",
  ah(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1, "Name your design").max(120) }), req.body);
    const d = await one("update designs set name = $3 where id = $1 and user_id = $2 returning id, name", [req.params.id, req.user!.id, body.name]);
    if (!d) throw notFound("Design not found.");
    res.json(d);
  }),
);

customerRouter.delete(
  "/designs/:id",
  ah(async (req, res) => {
    const d = await one("delete from designs where id = $1 and user_id = $2 returning id", [req.params.id, req.user!.id]);
    if (!d) throw notFound("Design not found.");
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- orders

const ORDER_LIST = `
  select o.id, o.order_number, o.status, o.payment_status, o.quantity, o.total_pence, o.currency, o.config,
         o.created_at, o.paid_at, o.invoice_number, o.reorder_of, o.csv_row_count,
         p.name as product_name, p.slug as product_slug, d.name as division_name,
         (select json_build_object('id', pr.id, 'version', pr.version, 'status', pr.status)
            from proofs pr where pr.order_id = o.id order by pr.version desc limit 1) as latest_proof
  from orders o join products p on p.id = o.product_id join divisions d on d.id = p.division_id`;

customerRouter.get(
  "/orders",
  ah(async (req, res) => {
    res.json(await query(`${ORDER_LIST} where o.user_id = $1 order by o.created_at desc`, [req.user!.id]));
  }),
);

/** Customer dashboard summary (§10). */
customerRouter.get(
  "/dashboard",
  ah(async (req, res) => {
    const uid = req.user!.id;
    const [counts] = await query(
      `select count(*) filter (where payment_status = 'paid') as orders,
              count(*) filter (where payment_status = 'paid' and status not in ('completed')) as active,
              count(*) filter (where status = 'proof') as awaiting_approval,
              count(*) filter (where status = 'quote' and payment_status = 'unpaid') as quotes,
              coalesce(sum(total_pence) filter (where payment_status = 'paid'), 0) as spent_pence
       from orders where user_id = $1`,
      [uid],
    );
    const designs = await one<{ n: number }>("select count(*) as n from designs where user_id = $1", [uid]);
    const recent = await query(`${ORDER_LIST} where o.user_id = $1 order by o.created_at desc limit 5`, [uid]);
    const proofs = await query(
      `select pr.id, pr.version, pr.status, pr.created_at, o.id as order_id, o.order_number, p.name as product_name
       from proofs pr join orders o on o.id = pr.order_id join products p on p.id = o.product_id
       where o.user_id = $1 and o.status in ('proof', 'artwork') and pr.version = (select max(version) from proofs where order_id = o.id)
       order by pr.created_at desc`,
      [uid],
    );
    res.json({ counts: { ...counts, designs: designs?.n ?? 0 }, recent, activeProofs: proofs });
  }),
);

customerRouter.get(
  "/orders/:id",
  ah(async (req, res) => {
    const o = await getOrderFor(req.user!, String(req.params.id));
    const product = await one(
      `select p.id, p.name, p.slug, p.print_spec, p.materials, p.supports_csv, d.name as division_name, d.slug as division_slug
       from products p join divisions d on d.id = p.division_id where p.id = $1`,
      [o.product_id],
    );
    const proofs = await query(
      `select id, version, status, source, customer_note, fit_report, created_at, decided_at, preview_path is not null as has_preview
       from proofs where order_id = $1 order by version desc`,
      [o.id],
    );
    const history = await query("select from_status, to_status, note, created_at from order_status_history where order_id = $1 order by created_at", [o.id]);
    const approvals = await query("select version, action, actor_email, note, created_at from approval_logs where order_id = $1 order by created_at", [o.id]);
    const reorderOf = o.reorder_of ? await one("select id, order_number from orders where id = $1", [o.reorder_of]) : null;
    // Customers never see production files (§10) — only proofs and invoices.
    const { stripe_session_id: _s, ...safe } = o as any;
    res.json({ ...safe, product, proofs, history, approvals, reorderOfOrder: reorderOf, paymentsMode });
  }),
);

customerRouter.post(
  "/orders",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        productId: z.string().min(1),
        config: configSchema,
        design: designSchema.nullable().optional(),
        artworkAssetId: uuid.nullable().optional(),
        csvAssetId: uuid.nullable().optional(),
        designId: uuid.nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
      }),
      req.body,
    );
    const order = await createOrder(req.user!, body);
    res.status(201).json(order);
  }),
);

customerRouter.delete(
  "/orders/:id",
  ah(async (req, res) => {
    await deleteQuote(req.user!, String(req.params.id));
    res.json({ ok: true });
  }),
);

customerRouter.post(
  "/orders/:id/checkout",
  ah(async (req, res) => {
    const o = await getOrderFor(req.user!, String(req.params.id));
    if (o.user_id !== req.user!.id) throw conflict("Only the customer can pay for this order.");
    res.json(await startCheckout(o, req.user!.email));
  }),
);

customerRouter.post(
  "/orders/:id/confirm",
  ah(async (req, res) => {
    const body = parse(z.object({ sessionId: z.string().min(1) }), req.body);
    const o = await getOrderFor(req.user!, String(req.params.id));
    if (o.payment_status === "paid") return res.json({ paid: true });
    const r = await confirmStripeSession(o, body.sessionId);
    res.json({ paid: Boolean(r) || (await getOrderFor(req.user!, o.id)).payment_status === "paid" });
  }),
);

/** TEST PAYMENT mode only (no Stripe key configured). */
customerRouter.post(
  "/orders/:id/test-pay",
  ah(async (req, res) => {
    if (paymentsMode !== "test") throw conflict("Test payments are disabled — Stripe is configured.");
    const o = await getOrderFor(req.user!, String(req.params.id));
    if (o.user_id !== req.user!.id) throw conflict("Only the customer can pay for this order.");
    if (o.payment_status === "paid") return res.json({ paid: true });
    await markPaid(o.id, `test_${Date.now()}`);
    res.json({ paid: true });
  }),
);

customerRouter.post(
  "/orders/:id/proofs/:proofId/approve",
  ah(async (req, res) => {
    await approveProof(req.user!, String(req.params.id), String(req.params.proofId), clientIp(req));
    res.json({ ok: true });
  }),
);

customerRouter.post(
  "/orders/:id/proofs/:proofId/request-changes",
  ah(async (req, res) => {
    const body = parse(z.object({ note: z.string().trim().min(3, "Tell us what to change").max(2000) }), req.body);
    await requestChanges(req.user!, String(req.params.id), String(req.params.proofId), body.note, clientIp(req));
    res.json({ ok: true });
  }),
);

customerRouter.put(
  "/orders/:id/artwork",
  ah(async (req, res) => {
    const body = parse(z.object({ design: designSchema.nullable().optional(), artworkAssetId: uuid.nullable().optional() }), req.body);
    const proof = await resubmitArtwork(req.user!, String(req.params.id), body);
    res.json({ ok: true, proofId: proof.id, version: proof.version });
  }),
);

customerRouter.post(
  "/orders/:id/reorder",
  ah(async (req, res) => {
    res.status(201).json(await reorder(req.user!, String(req.params.id)));
  }),
);

customerRouter.get(
  "/orders/:id/invoice",
  ah(async (req, res) => {
    const o = await getOrderFor(req.user!, String(req.params.id));
    if (o.payment_status !== "paid") throw conflict("The invoice is available once the order is paid.");
    const pdf = await invoicePdf(o);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${o.invoice_number}_${o.order_number}.pdf"`);
    res.send(pdf);
  }),
);

async function proofFile(req: Request, kind: "preview" | "pdf") {
  const o = await getOrderFor(req.user!, String(req.params.id));
  const p = await one<{ preview_path: string | null; pdf_path: string | null; version: number }>(
    "select preview_path, pdf_path, version from proofs where id = $1 and order_id = $2",
    [req.params.proofId, o.id],
  );
  if (!p) throw notFound("Proof not found.");
  const path = kind === "preview" ? p.preview_path : p.pdf_path;
  if (!path) throw notFound("This proof has no preview image.");
  return { buf: await getFile(path), name: path.split("/").pop()! };
}

customerRouter.get(
  "/orders/:id/proofs/:proofId/preview",
  ah(async (req, res) => {
    const f = await proofFile(req, "preview");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(f.buf);
  }),
);

customerRouter.get(
  "/orders/:id/proofs/:proofId/pdf",
  ah(async (req, res) => {
    const f = await proofFile(req, "pdf");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${f.name}"`);
    res.send(f.buf);
  }),
);
