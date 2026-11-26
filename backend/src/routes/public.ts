import { Router } from "express";
import { z } from "zod";
import { env, paymentsMode } from "../config/env.js";
import { one, query } from "../config/db.js";
import { ah, notFound, parse } from "../lib/errors.js";
import { configSchema } from "../lib/schemas.js";
import { PRODUCT_SELECT, getProduct, getTiers } from "../services/catalog.js";
import { getFile, storageDriver } from "../services/storage.js";
import { calculateQuote, validateConfig } from "../shared/pricing.js";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/** Runtime settings the storefront needs. */
publicRouter.get("/config", (_req, res) => {
  res.json({ paymentsMode, currency: env.CURRENCY, vatRate: env.VAT_RATE, storage: storageDriver });
});

/** Product hub: every active division with its active products. */
publicRouter.get(
  "/catalog/divisions",
  ah(async (_req, res) => {
    const divisions = await query(
      "select id, slug, name, tagline, description, sort_order from divisions where is_active order by sort_order, name",
    );
    const products = await query(
      `${PRODUCT_SELECT} where p.is_active and d.is_active order by p.sort_order, p.name`,
    );
    const fromPrices = await Promise.all(products.map(async (p) => fromPrice(p)));
    res.json(
      divisions.map((d) => ({
        ...d,
        products: products
          .map((p, i) => ({ ...summary(p), fromPrice: fromPrices[i] }))
          .filter((p) => p.division_id === d.id),
      })),
    );
  }),
);

publicRouter.get(
  "/catalog/divisions/:slug",
  ah(async (req, res) => {
    const d = await one("select id, slug, name, tagline, description from divisions where slug = $1 and is_active", [req.params.slug]);
    if (!d) throw notFound("Division not found.");
    const products = await query(`${PRODUCT_SELECT} where p.division_id = $1 and p.is_active order by p.sort_order, p.name`, [d.id]);
    const withPrice = await Promise.all(products.map(async (p) => ({ ...summary(p), fromPrice: await fromPrice(p) })));
    res.json({ ...d, products: withPrice });
  }),
);

/** Everything the configurator needs: options, limits, pricing rules, tiers, templates. */
publicRouter.get(
  "/catalog/products/:slug",
  ah(async (req, res) => {
    const p = await getProduct(String(req.params.slug));
    if (!p.is_active) throw notFound("Product not found.");
    const tiers = await getTiers(p.id);
    const templates = await query(
      "select id, name, description, design from templates where product_id = $1 and is_active order by sort_order, name",
      [p.id],
    );
    res.json({ ...p, tiers, templates, vatRate: env.VAT_RATE, currency: env.CURRENCY });
  }),
);

/** Server-side price check (the browser computes the same instantly with the shared engine). */
publicRouter.post(
  "/pricing/quote",
  ah(async (req, res) => {
    const body = parse(z.object({ productId: z.string().min(1), config: configSchema }), req.body);
    const p = await getProduct(body.productId);
    const errors = validateConfig(p, body.config);
    const quote = calculateQuote(p, await getTiers(p.id), body.config, env.VAT_RATE);
    res.json({ errors, quote });
  }),
);

publicRouter.get(
  "/gallery",
  ah(async (req, res) => {
    const division = typeof req.query.division === "string" ? req.query.division : null;
    const rows = await query(
      `select g.id, g.title, g.description, g.created_at, d.slug as division_slug, d.name as division_name
       from gallery_items g join divisions d on d.id = g.division_id
       where g.is_published and d.is_active ${division ? "and d.slug = $1" : ""}
       order by d.sort_order, g.sort_order, g.created_at desc`,
      division ? [division] : [],
    );
    res.json(rows);
  }),
);

publicRouter.get(
  "/gallery/:id/image",
  ah(async (req, res) => {
    const g = await one<{ image_path: string }>("select image_path from gallery_items where id = $1 and is_published", [req.params.id]);
    if (!g) throw notFound();
    const buf = await getFile(g.image_path);
    res.setHeader("Content-Type", g.image_path.endsWith(".jpg") ? "image/jpeg" : "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  }),
);

function summary(p: any) {
  return {
    id: p.id,
    division_id: p.division_id,
    division_slug: p.division_slug,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    supports_csv: p.supports_csv,
    sizes: p.sizes,
    materials: p.materials,
    quantity_limits: p.quantity_limits,
  };
}

/** "From" price: the smallest preset at the minimum quantity, VAT inclusive. */
async function fromPrice(p: any): Promise<number | null> {
  const size = [...(p.sizes || [])].sort((a: any, b: any) => a.w * a.h - b.w * b.h)[0] || {
    w: p.size_limits?.minW || 50,
    h: p.size_limits?.minH || 50,
  };
  const material = [...(p.materials || [])].sort((a: any, b: any) => a.multiplier - b.multiplier)[0];
  if (!material) return null;
  const qty = p.quantity_limits?.min || 1;
  const q = calculateQuote(p, await getTiers(p.id), { widthMm: size.w, heightMm: size.h, material: material.key, orientation: "portrait", quantity: qty }, env.VAT_RATE);
  return Math.round((q.totalPence / qty)) / 100;
}
