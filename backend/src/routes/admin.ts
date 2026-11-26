import { Router } from "express";
import { ZipArchive } from "archiver";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, query, tx } from "../config/db.js";
import { ah, badRequest, conflict, notFound, parse } from "../lib/errors.js";
import { designSchema, uuid } from "../lib/schemas.js";
import { requireAdmin } from "../middleware/auth.js";
import { storeUpload } from "../services/assets.js";
import { getProduct } from "../services/catalog.js";
import { getFile, removeFiles } from "../services/storage.js";
import { STATUSES, adminSetStatus, generatePrintFiles, getOrder, issueProof, resubmitArtwork } from "../services/orders.js";
import { invoicePdf } from "../services/invoice.js";
import { upload } from "./customer.js";
import { formatMoney } from "../shared/pricing.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// =============================================================== ORDERS

/** Searchable job database (§11): filter by status, customer, date, product type. */
adminRouter.get(
  "/orders",
  ah(async (req, res) => {
    const f = parse(
      z.object({
        status: z.enum(STATUSES).optional(),
        q: z.string().trim().max(100).optional(),
        division: z.string().max(60).optional(),
        product: z.string().max(80).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        archived: z.enum(["true", "false", "all"]).optional(),
        payment: z.enum(["paid", "unpaid", "all"]).optional(),
        page: z.coerce.number().int().min(1).max(10000).optional(),
      }),
      req.query,
    );
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (f.status) add("o.status = ?", f.status);
    if (f.division) add("d.slug = ?", f.division);
    if (f.product) add("p.slug = ?", f.product);
    if (f.from) add("o.created_at >= ?::date", f.from);
    if (f.to) add("o.created_at < (?::date + interval '1 day')", f.to);
    if (f.q) add("(o.order_number ilike ? or u.email ilike $X or u.full_name ilike $X or coalesce(u.company,'') ilike $X)".replace(/\$X/g, `$${params.length + 1}`), `%${f.q}%`);
    const archived = f.archived ?? "false";
    if (archived !== "all") where.push(`o.archived = ${archived === "true"}`);
    const payment = f.payment ?? "all";
    if (payment !== "all") add("o.payment_status = ?", payment);
    const page = f.page ?? 1;
    const sqlWhere = where.length ? `where ${where.join(" and ")}` : "";
    const base = `from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id join divisions d on d.id = p.division_id ${sqlWhere}`;
    const [{ total }] = await query(`select count(*) as total ${base}`, params);
    const rows = await query(
      `select o.id, o.order_number, o.status, o.payment_status, o.quantity, o.total_pence, o.currency, o.files_ready, o.archived,
              o.created_at, o.paid_at, o.csv_row_count, o.config,
              u.full_name as customer_name, u.email as customer_email, u.company as customer_company,
              p.name as product_name, p.slug as product_slug, d.name as division_name, d.slug as division_slug,
              (select max(version) from proofs where order_id = o.id) as proof_version
       ${base} order by o.created_at desc limit 25 offset ${(page - 1) * 25}`,
      params,
    );
    const counts = await query("select status, count(*) as n from orders where not archived group by status");
    res.json({ rows, total, page, pageSize: 25, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
  }),
);

adminRouter.get(
  "/orders/:id",
  ah(async (req, res) => {
    const o = await getOrder(String(req.params.id));
    const customer = await one("select id, email, full_name, company, phone from users where id = $1", [o.user_id]);
    const product = await one(
      `select p.id, p.name, p.slug, p.print_spec, p.materials, p.supports_csv, d.name as division_name
       from products p join divisions d on d.id = p.division_id where p.id = $1`,
      [o.product_id],
    );
    const proofs = await query(
      `select pr.id, pr.version, pr.status, pr.source, pr.customer_note, pr.fit_report, pr.created_at, pr.decided_at,
              pr.preview_path is not null as has_preview, u.email as decided_by_email
       from proofs pr left join users u on u.id = pr.decided_by where pr.order_id = $1 order by pr.version desc`,
      [o.id],
    );
    const files = await query("select id, kind, filename, size_bytes, rows, created_at from print_files where order_id = $1 order by kind", [o.id]);
    const history = await query(
      `select h.from_status, h.to_status, h.note, h.created_at, u.email as actor_email
       from order_status_history h left join users u on u.id = h.actor_id where h.order_id = $1 order by h.created_at`,
      [o.id],
    );
    const approvals = await query("select version, action, actor_email, note, ip, created_at from approval_logs where order_id = $1 order by created_at", [o.id]);
    const notifications = await query("select to_email, subject, status, created_at from notifications where order_id = $1 order by created_at desc", [o.id]);
    const assets = await query(
      "select id, kind, original_name, mime, size_bytes from assets where id = any($1::uuid[])",
      [[o.artwork_asset_id, o.csv_asset_id].filter(Boolean)],
    );
    const reorderOf = o.reorder_of ? await one("select id, order_number from orders where id = $1", [o.reorder_of]) : null;
    res.json({ ...o, customer, product, proofs, files, history, approvals, notifications, sourceAssets: assets, reorderOfOrder: reorderOf });
  }),
);

adminRouter.post(
  "/orders/:id/status",
  ah(async (req, res) => {
    const body = parse(z.object({ to: z.enum(STATUSES), note: z.string().trim().max(500).nullable().optional() }), req.body);
    res.json(await adminSetStatus(req.user!, String(req.params.id), body.to, body.note || null));
  }),
);

/** Issue a proof: regenerate from the current artwork, or from a file the studio uploaded. */
adminRouter.post(
  "/orders/:id/proofs",
  ah(async (req, res) => {
    const body = parse(z.object({ artworkAssetId: uuid.nullable().optional(), design: designSchema.nullable().optional() }), req.body ?? {});
    const o = await getOrder(String(req.params.id));
    if (body.artworkAssetId || body.design) {
      if (o.status !== "artwork") {
        // allow the studio to replace artwork from ORDER / PROOF too by first moving to ARTWORK
        if (!["order", "proof"].includes(o.status)) throw conflict("Artwork can only be replaced before production.");
        await adminSetStatus(req.user!, o.id, "artwork", "Studio is revising the artwork");
      }
      const proof = await resubmitArtwork(req.user!, o.id, { artworkAssetId: body.artworkAssetId, design: body.design });
      return res.status(201).json(proof);
    }
    const proof = await issueProof(o.id, { source: "admin_upload", actorId: req.user!.id });
    res.status(201).json(proof);
  }),
);

adminRouter.post(
  "/orders/:id/uploads",
  upload.single("file"),
  ah(async (req, res) => {
    const o = await getOrder(String(req.params.id));
    if (!req.file) throw badRequest("Choose a file to upload.");
    // Studio uploads are owned by the customer so the order's ownership rules hold.
    const owner = await one("select id, email, full_name, role from users where id = $1", [o.user_id]);
    const { asset } = await storeUpload(owner as any, "artwork", req.file);
    res.status(201).json({ id: asset.id, originalName: asset.original_name, meta: asset.meta });
  }),
);

adminRouter.post(
  "/orders/:id/regenerate-files",
  ah(async (req, res) => {
    const o = await getOrder(String(req.params.id));
    if (!["production", "completed"].includes(o.status)) throw conflict("Files are generated once a proof is approved.");
    await generatePrintFiles(o.id);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/orders/:id/archive",
  ah(async (req, res) => {
    const body = parse(z.object({ archived: z.boolean() }), req.body);
    const o = await getOrder(String(req.params.id));
    if (body.archived && o.status !== "completed") throw conflict("Only completed jobs can be archived.");
    await query("update orders set archived = $2, archived_at = case when $2 then now() else null end where id = $1", [o.id, body.archived]);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/orders/:id/files/:fileId",
  ah(async (req, res) => {
    const f = await one<{ filename: string; storage_path: string; kind: string }>(
      "select filename, storage_path, kind from print_files where id = $1 and order_id = $2",
      [req.params.fileId, req.params.id],
    );
    if (!f) throw notFound("File not found.");
    const type = f.filename.endsWith(".pdf") ? "application/pdf" : f.filename.endsWith(".png") ? "image/png" : "application/zip";
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="${f.filename}"`);
    res.send(await getFile(f.storage_path));
  }),
);

/** All production files for a job in one zip, in an order-based folder. */
adminRouter.get(
  "/orders/:id/files-zip",
  ah(async (req, res) => {
    const o = await getOrder(String(req.params.id));
    if (!o.files_ready) throw conflict("Files are locked until a proof is approved.");
    const files = await query<{ filename: string; storage_path: string }>("select filename, storage_path from print_files where order_id = $1", [o.id]);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${o.order_number}_production.zip"`);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (e: Error) => res.destroy(e));
    archive.pipe(res);
    for (const f of files) archive.append(await getFile(f.storage_path), { name: `${o.order_number}/${f.filename}` });
    await archive.finalize();
  }),
);

adminRouter.get(
  "/orders/:id/proofs/:proofId/:kind",
  ah(async (req, res) => {
    const kind = String(req.params.kind);
    const p = await one<{ preview_path: string | null; pdf_path: string | null }>(
      "select preview_path, pdf_path from proofs where id = $1 and order_id = $2",
      [req.params.proofId, req.params.id],
    );
    if (!p) throw notFound("Proof not found.");
    const path = kind === "preview" ? p.preview_path : kind === "pdf" ? p.pdf_path : null;
    if (!path) throw notFound();
    res.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "image/png");
    if (kind === "pdf") res.setHeader("Content-Disposition", `inline; filename="${path.split("/").pop()}"`);
    res.send(await getFile(path));
  }),
);

adminRouter.get(
  "/orders/:id/invoice",
  ah(async (req, res) => {
    const o = await getOrder(String(req.params.id));
    if (o.payment_status !== "paid") throw conflict("Not paid yet.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${o.invoice_number}_${o.order_number}.pdf"`);
    res.send(await invoicePdf(o));
  }),
);

adminRouter.get(
  "/assets/:id/original",
  ah(async (req, res) => {
    const a = await one("select * from assets where id = $1", [req.params.id]);
    if (!a) throw notFound();
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${a.original_name.replace(/"/g, "")}"`);
    res.send(await getFile(a.storage_path));
  }),
);

// ================================================================ USERS

adminRouter.get(
  "/users",
  ah(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const role = req.query.role === "admin" || req.query.role === "customer" ? req.query.role : null;
    const params: unknown[] = [];
    const where: string[] = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(u.email ilike $${params.length} or u.full_name ilike $${params.length} or coalesce(u.company,'') ilike $${params.length})`);
    }
    if (role) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    const rows = await query(
      `select u.id, u.email, u.full_name, u.company, u.phone, u.role, u.is_active, u.created_at, u.last_login_at,
              count(o.id) filter (where o.payment_status = 'paid') as orders,
              coalesce(sum(o.total_pence) filter (where o.payment_status = 'paid'), 0) as spent_pence
       from users u left join orders o on o.user_id = u.id
       ${where.length ? `where ${where.join(" and ")}` : ""}
       group by u.id order by u.created_at desc limit 200`,
      params,
    );
    res.json(rows);
  }),
);

adminRouter.post(
  "/users",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        email: z.string().trim().toLowerCase().email("Enter a valid e-mail"),
        fullName: z.string().trim().min(2, "Enter a name").max(100),
        password: z.string().min(8, "Use at least 8 characters").max(128),
        role: z.enum(["customer", "admin"]),
        company: z.string().trim().max(120).nullable().optional(),
      }),
      req.body,
    );
    if (await one("select 1 from users where email = $1", [body.email])) throw conflict("A user with that e-mail already exists.");
    const u = await one(
      "insert into users (email, password_hash, full_name, role, company) values ($1,$2,$3,$4,$5) returning id, email, full_name, role",
      [body.email, await bcrypt.hash(body.password, 11), body.fullName, body.role, body.company || null],
    );
    res.status(201).json(u);
  }),
);

adminRouter.patch(
  "/users/:id",
  ah(async (req, res) => {
    const body = parse(z.object({ role: z.enum(["customer", "admin"]).optional(), isActive: z.boolean().optional(), fullName: z.string().trim().min(2).max(100).optional() }), req.body);
    const id = String(req.params.id);
    if (id === req.user!.id && (body.role === "customer" || body.isActive === false)) {
      throw conflict("You can't remove your own admin access or deactivate yourself.");
    }
    const u = await one(
      `update users set role = coalesce($2, role), is_active = coalesce($3, is_active), full_name = coalesce($4, full_name)
       where id = $1 returning id, email, full_name, role, is_active`,
      [id, body.role ?? null, body.isActive ?? null, body.fullName ?? null],
    );
    if (!u) throw notFound("User not found.");
    res.json(u);
  }),
);

// ============================================================== CATALOG

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and dashes").max(60);

adminRouter.get(
  "/divisions",
  ah(async (_req, res) => {
    res.json(await query("select d.*, (select count(*) from products p where p.division_id = d.id) as product_count from divisions d order by sort_order, name"));
  }),
);

const divisionBody = z.object({
  slug,
  name: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(160).default(""),
  description: z.string().trim().max(2000).default(""),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

adminRouter.post(
  "/divisions",
  ah(async (req, res) => {
    const b = parse(divisionBody, req.body);
    res.status(201).json(
      await one("insert into divisions (slug, name, tagline, description, sort_order, is_active) values ($1,$2,$3,$4,$5,$6) returning *", [
        b.slug, b.name, b.tagline, b.description, b.sortOrder, b.isActive,
      ]),
    );
  }),
);

adminRouter.put(
  "/divisions/:id",
  ah(async (req, res) => {
    const b = parse(divisionBody, req.body);
    const d = await one("update divisions set slug=$2, name=$3, tagline=$4, description=$5, sort_order=$6, is_active=$7 where id=$1 returning *", [
      req.params.id, b.slug, b.name, b.tagline, b.description, b.sortOrder, b.isActive,
    ]);
    if (!d) throw notFound("Division not found.");
    res.json(d);
  }),
);

adminRouter.delete(
  "/divisions/:id",
  ah(async (req, res) => {
    const n = await one<{ n: number }>("select count(*) as n from products where division_id = $1", [req.params.id]);
    if (n && n.n > 0) throw conflict("Move or delete this division's products first, or hide the division instead.");
    await query("delete from divisions where id = $1", [req.params.id]);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/products",
  ah(async (_req, res) => {
    res.json(
      await query(
        `select p.*, d.name as division_name, d.slug as division_slug,
                (select count(*) from templates t where t.product_id = p.id) as template_count,
                (select count(*) from orders o where o.product_id = p.id) as order_count
         from products p join divisions d on d.id = p.division_id order by d.sort_order, p.sort_order, p.name`,
      ),
    );
  }),
);

const productBody = z
  .object({
    divisionId: uuid,
    slug,
    name: z.string().trim().min(2).max(100),
    summary: z.string().trim().max(240).default(""),
    description: z.string().trim().max(4000).default(""),
    isActive: z.boolean(),
    supportsCsv: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    sizes: z.array(z.object({ label: z.string().trim().min(1).max(40), w: z.number().positive().max(5000), h: z.number().positive().max(5000) })).max(30),
    sizeLimits: z.object({ allowCustom: z.boolean(), minW: z.number().positive(), maxW: z.number().positive(), minH: z.number().positive(), maxH: z.number().positive() }),
    materials: z.array(z.object({ key: slug, label: z.string().trim().min(1).max(60), multiplier: z.number().positive().max(100), description: z.string().max(200).optional() })).min(1, "Add at least one material").max(20),
    orientations: z.array(z.enum(["portrait", "landscape"])).min(1, "Allow at least one orientation"),
    quantityLimits: z.object({ min: z.number().int().min(1), max: z.number().int().min(1), step: z.number().int().min(1) }),
    pricing: z.object({ baseUnit: z.number().min(0), perCm2: z.number().min(0), minUnit: z.number().min(0), setupFee: z.number().min(0).default(0) }),
    printSpec: z.object({ bleedMm: z.number().min(0).max(20), safeMm: z.number().min(0).max(50), dpi: z.number().int().min(72).max(1200), cornerRadiusMm: z.number().min(0).max(500).default(0) }),
  })
  .refine((b) => b.quantityLimits.max >= b.quantityLimits.min, { message: "Max quantity must be at least the minimum", path: ["quantityLimits"] })
  .refine((b) => b.sizes.length > 0 || b.sizeLimits.allowCustom, { message: "Add a preset size or allow custom sizes", path: ["sizes"] })
  .refine((b) => b.sizeLimits.maxW >= b.sizeLimits.minW && b.sizeLimits.maxH >= b.sizeLimits.minH, { message: "Max size must be at least the min size", path: ["sizeLimits"] });

function productParams(b: z.infer<typeof productBody>) {
  return [
    b.divisionId, b.slug, b.name, b.summary, b.description, b.isActive, b.supportsCsv, JSON.stringify(b.sizes), b.sizeLimits,
    JSON.stringify(b.materials), JSON.stringify(b.orientations), b.quantityLimits, b.pricing, b.printSpec, b.sortOrder,
  ];
}

adminRouter.post(
  "/products",
  ah(async (req, res) => {
    const b = parse(productBody, req.body);
    const p = await one(
      `insert into products (division_id, slug, name, summary, description, is_active, supports_csv, sizes, size_limits, materials, orientations, quantity_limits, pricing, print_spec, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      productParams(b),
    );
    res.status(201).json(p);
  }),
);

adminRouter.put(
  "/products/:id",
  ah(async (req, res) => {
    const b = parse(productBody, req.body);
    const p = await one(
      `update products set division_id=$1, slug=$2, name=$3, summary=$4, description=$5, is_active=$6, supports_csv=$7, sizes=$8, size_limits=$9,
         materials=$10, orientations=$11, quantity_limits=$12, pricing=$13, print_spec=$14, sort_order=$15 where id=$16 returning *`,
      [...productParams(b), req.params.id],
    );
    if (!p) throw notFound("Product not found.");
    res.json(p);
  }),
);

adminRouter.delete(
  "/products/:id",
  ah(async (req, res) => {
    const n = await one<{ n: number }>("select count(*) as n from orders where product_id = $1", [req.params.id]);
    if (n && n.n > 0) throw conflict("This product has orders, so it can't be deleted. Set it to inactive instead.");
    await query("delete from products where id = $1", [req.params.id]);
    res.json({ ok: true });
  }),
);

/** Volume-discount tiers. productId omitted = global default tiers. */
adminRouter.get(
  "/tiers",
  ah(async (req, res) => {
    const pid = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : null;
    res.json(
      await query(
        `select min_qty as "minQty", discount_pct as "discountPct" from discount_tiers where ${pid ? "product_id = $1" : "product_id is null"} order by min_qty`,
        pid ? [pid] : [],
      ),
    );
  }),
);

adminRouter.put(
  "/tiers",
  ah(async (req, res) => {
    const b = parse(
      z.object({
        productId: uuid.nullable(),
        tiers: z.array(z.object({ minQty: z.number().int().min(1), discountPct: z.number().min(0).max(90) })).max(12),
      }),
      req.body,
    );
    const qtys = b.tiers.map((t) => t.minQty);
    if (new Set(qtys).size !== qtys.length) throw badRequest("Each tier needs a different minimum quantity.");
    await tx(async (c) => {
      await c.query(`delete from discount_tiers where ${b.productId ? "product_id = $1" : "product_id is null"}`, b.productId ? [b.productId] : []);
      for (const t of b.tiers) {
        await c.query("insert into discount_tiers (product_id, min_qty, discount_pct) values ($1,$2,$3)", [b.productId, t.minQty, t.discountPct]);
      }
    });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/templates",
  ah(async (req, res) => {
    const pid = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : null;
    res.json(
      await query(
        `select t.*, p.name as product_name, p.slug as product_slug from templates t join products p on p.id = t.product_id
         ${pid ? "where t.product_id = $1" : ""} order by p.name, t.sort_order, t.name`,
        pid ? [pid] : [],
      ),
    );
  }),
);

const templateBody = z.object({
  productId: uuid,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  design: designSchema,
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

function assertTemplateDesign(design: z.infer<typeof designSchema>) {
  if (design.elements.some((e) => e.type === "image")) throw badRequest("Templates can contain text and shapes only (customers add their own logos).");
}

adminRouter.post(
  "/templates",
  ah(async (req, res) => {
    const b = parse(templateBody, req.body);
    assertTemplateDesign(b.design);
    await getProduct(b.productId);
    res.status(201).json(
      await one("insert into templates (product_id, name, description, design, is_active, sort_order, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *", [
        b.productId, b.name, b.description, b.design, b.isActive, b.sortOrder, req.user!.id,
      ]),
    );
  }),
);

adminRouter.put(
  "/templates/:id",
  ah(async (req, res) => {
    const b = parse(templateBody, req.body);
    assertTemplateDesign(b.design);
    const t = await one("update templates set product_id=$2, name=$3, description=$4, design=$5, is_active=$6, sort_order=$7 where id=$1 returning *", [
      req.params.id, b.productId, b.name, b.description, b.design, b.isActive, b.sortOrder,
    ]);
    if (!t) throw notFound("Template not found.");
    res.json(t);
  }),
);

adminRouter.patch(
  "/templates/:id",
  ah(async (req, res) => {
    const b = parse(z.object({ isActive: z.boolean() }), req.body);
    const t = await one("update templates set is_active = $2 where id = $1 returning id, is_active", [req.params.id, b.isActive]);
    if (!t) throw notFound("Template not found.");
    res.json(t);
  }),
);

adminRouter.delete(
  "/templates/:id",
  ah(async (req, res) => {
    await query("delete from templates where id = $1", [req.params.id]);
    res.json({ ok: true });
  }),
);

// ============================================================== GALLERY

adminRouter.get(
  "/gallery",
  ah(async (_req, res) => {
    res.json(
      await query(
        `select g.id, g.title, g.description, g.is_published, g.sort_order, g.created_at, g.division_id, d.name as division_name
         from gallery_items g join divisions d on d.id = g.division_id order by d.sort_order, g.sort_order, g.created_at desc`,
      ),
    );
  }),
);

adminRouter.post(
  "/gallery",
  upload.single("file"),
  ah(async (req, res) => {
    const b = parse(
      z.object({ divisionId: uuid, title: z.string().trim().min(2, "Add a title").max(100), description: z.string().trim().max(300).default("") }),
      req.body,
    );
    if (!req.file) throw badRequest("Choose an image.");
    const { asset } = await storeUpload(req.user!, "gallery", req.file);
    const g = await one("insert into gallery_items (division_id, title, description, image_path) values ($1,$2,$3,$4) returning *", [
      b.divisionId, b.title, b.description, asset.png_path,
    ]);
    res.status(201).json(g);
  }),
);

adminRouter.patch(
  "/gallery/:id",
  ah(async (req, res) => {
    const b = parse(
      z.object({ title: z.string().trim().min(2).max(100).optional(), description: z.string().max(300).optional(), isPublished: z.boolean().optional(), divisionId: uuid.optional() }),
      req.body,
    );
    const g = await one(
      `update gallery_items set title = coalesce($2, title), description = coalesce($3, description), is_published = coalesce($4, is_published),
         division_id = coalesce($5, division_id) where id = $1 returning *`,
      [req.params.id, b.title ?? null, b.description ?? null, b.isPublished ?? null, b.divisionId ?? null],
    );
    if (!g) throw notFound();
    res.json(g);
  }),
);

adminRouter.delete(
  "/gallery/:id",
  ah(async (req, res) => {
    const g = await one<{ image_path: string }>("delete from gallery_items where id = $1 returning image_path", [req.params.id]);
    if (g) await removeFiles([g.image_path]).catch(() => undefined);
    res.json({ ok: true });
  }),
);

// ============================================================== REPORTS

const range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function rangeSql(r: z.infer<typeof range>, col = "o.paid_at") {
  const from = r.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = r.to ?? new Date().toISOString().slice(0, 10);
  return { from, to, sql: `${col} >= $1::date and ${col} < ($2::date + interval '1 day')` };
}

/** Reports & analytics (§11): totals for orders, revenue and product-family throughput. */
adminRouter.get(
  "/reports",
  ah(async (req, res) => {
    const r = rangeSql(parse(range, req.query));
    const p = [r.from, r.to];
    const [totals] = await query(
      `select count(*) as orders, coalesce(sum(total_pence),0) as revenue_pence, coalesce(sum(subtotal_pence),0) as net_pence,
              coalesce(sum(vat_pence),0) as vat_pence, coalesce(sum(quantity),0) as units,
              coalesce(round(avg(total_pence)),0) as avg_order_pence
       from orders o where o.payment_status = 'paid' and ${r.sql}`,
      p,
    );
    const byDivision = await query(
      `select d.name as division, d.slug, count(o.id) as orders, coalesce(sum(o.quantity),0) as units, coalesce(sum(o.total_pence),0) as revenue_pence,
              count(o.id) filter (where o.status = 'completed') as completed
       from divisions d left join products p on p.division_id = d.id
       left join orders o on o.product_id = p.id and o.payment_status = 'paid' and ${r.sql}
       group by d.id order by d.sort_order`,
      p,
    );
    const byProduct = await query(
      `select p.name as product, d.name as division, count(o.id) as orders, sum(o.quantity) as units, sum(o.total_pence) as revenue_pence
       from orders o join products p on p.id = o.product_id join divisions d on d.id = p.division_id
       where o.payment_status = 'paid' and ${r.sql} group by p.id, d.name order by revenue_pence desc limit 10`,
      p,
    );
    const daily = await query(
      `select to_char(day, 'YYYY-MM-DD') as day, coalesce(sum(o.total_pence),0) as revenue_pence, count(o.id) as orders
       from generate_series($1::date, $2::date, interval '1 day') day
       left join orders o on o.payment_status = 'paid' and o.paid_at >= day and o.paid_at < day + interval '1 day'
       group by day order by day`,
      p,
    );
    const pipeline = await query("select status, count(*) as n from orders where not archived and payment_status = 'paid' group by status");
    const [proofStats] = await query(
      `select count(*) filter (where action = 'approved') as approved, count(*) filter (where action = 'changes_requested') as changes,
              count(*) filter (where action = 'issued') as issued
       from approval_logs where created_at >= $1::date and created_at < ($2::date + interval '1 day')`,
      p,
    );
    const [customers] = await query("select count(*) filter (where role = 'customer') as customers, count(*) filter (where role = 'customer' and created_at >= $1::date) as new_customers from users", [r.from]);
    res.json({ from: r.from, to: r.to, totals, byDivision, byProduct, daily, pipeline, proofStats, customers });
  }),
);

/**
 * Accounting-ready export (§05): Xero "Sales invoice" CSV import format.
 * The same row shape maps 1:1 onto the Xero Invoices API for a later
 * live integration (§14).
 */
adminRouter.get(
  "/reports/xero.csv",
  ah(async (req, res) => {
    const r = rangeSql(parse(range, req.query));
    const rows = await query(
      `select o.*, u.full_name, u.email, u.company, p.name as product_name
       from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id
       where o.payment_status = 'paid' and ${r.sql} order by o.paid_at`,
      [r.from, r.to],
    );
    const header = [
      "*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "*Description",
      "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType", "TaxAmount", "Currency",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const o of rows) {
      const date = new Date(o.paid_at).toLocaleDateString("en-GB");
      lines.push(
        [
          o.company || o.full_name, o.email, o.invoice_number, o.order_number, date, date,
          `${o.product_name} ${Math.round(o.config.widthMm)}x${Math.round(o.config.heightMm)}mm ${o.config.material}`,
          o.quantity, (o.unit_price_net).toFixed(4), Number(o.discount_pct).toFixed(2), "200",
          o.vat_rate > 0 ? `${Math.round(o.vat_rate * 100)}% (GST on Income)` : "No GST", (o.vat_pence / 100).toFixed(2), o.currency,
        ].map(esc).join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="xero-sales-${r.from}_${r.to}.csv"`);
    res.send(lines.join("\n"));
  }),
);

/** Outbound e-mail log — handy when SMTP isn't configured. */
adminRouter.get(
  "/notifications",
  ah(async (_req, res) => {
    res.json(await query("select n.*, o.order_number from notifications n left join orders o on o.id = n.order_id order by n.created_at desc limit 100"));
  }),
);

adminRouter.get(
  "/overview",
  ah(async (_req, res) => {
    const [o] = await query(
      `select count(*) filter (where payment_status = 'paid' and status in ('order','artwork','proof','production')) as open_jobs,
              count(*) filter (where status = 'production') as in_production,
              count(*) filter (where status = 'proof') as awaiting_approval,
              count(*) filter (where status = 'artwork' and payment_status = 'paid') as artwork,
              count(*) filter (where payment_status = 'paid' and paid_at >= date_trunc('day', now())) as paid_today,
              coalesce(sum(total_pence) filter (where payment_status = 'paid' and paid_at >= date_trunc('month', now())), 0) as revenue_month_pence
       from orders where not archived`,
    );
    res.json({ ...o, revenue_month: formatMoney(o.revenue_month_pence) });
  }),
);
