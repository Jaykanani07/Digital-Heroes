import { one, query, type Queryable, pool } from "../config/db.js";
import { notFound } from "../lib/errors.js";
import type { DiscountTier, PricingProduct } from "../shared/pricing.js";
import type { PrintSpec } from "../shared/design.js";

export interface ProductRow extends PricingProduct {
  id: string;
  division_id: string;
  division_slug: string;
  division_name: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  is_active: boolean;
  supports_csv: boolean;
  print_spec: PrintSpec;
  sort_order: number;
}

export const PRODUCT_SELECT = `
  select p.*, d.slug as division_slug, d.name as division_name
  from products p join divisions d on d.id = p.division_id`;

export async function getProduct(idOrSlug: string, db: Queryable = pool): Promise<ProductRow> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const row = await one<ProductRow>(`${PRODUCT_SELECT} where ${isUuid ? "p.id" : "p.slug"} = $1`, [idOrSlug], db);
  if (!row) throw notFound("Product not found.");
  return row;
}

/** Product-specific tiers override the global ones. */
export async function getTiers(productId: string, db: Queryable = pool): Promise<DiscountTier[]> {
  const rows = await query<{ product_id: string | null; min_qty: number; discount_pct: number }>(
    `select product_id, min_qty, discount_pct from discount_tiers
     where product_id = $1 or product_id is null order by min_qty`,
    [productId],
    db,
  );
  const own = rows.filter((r) => r.product_id === productId);
  const use = own.length ? own : rows.filter((r) => r.product_id === null);
  return use.map((r) => ({ minQty: r.min_qty, discountPct: Number(r.discount_pct) }));
}

export async function getGlobalTiers(): Promise<DiscountTier[]> {
  const rows = await query<{ min_qty: number; discount_pct: number }>(
    "select min_qty, discount_pct from discount_tiers where product_id is null order by min_qty",
  );
  return rows.map((r) => ({ minQty: r.min_qty, discountPct: Number(r.discount_pct) }));
}
