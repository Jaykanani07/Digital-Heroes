import type { Design, PrintSpec } from "@/shared/design";
import type { DiscountTier, MaterialOption, Orientation, ProductConfig, ProductPricing, QuantityLimits, SizeLimits, SizePreset } from "@/shared/pricing";

export type OrderStatus = "quote" | "order" | "artwork" | "proof" | "production" | "completed";
export const PIPELINE: OrderStatus[] = ["quote", "order", "artwork", "proof", "production", "completed"];
export const STATUS_LABEL: Record<OrderStatus, string> = {
  quote: "Quote",
  order: "Order",
  artwork: "Artwork",
  proof: "Proof",
  production: "Production",
  completed: "Completed",
};

export interface ProductSummary {
  id: string;
  division_id: string;
  division_slug: string;
  slug: string;
  name: string;
  summary: string;
  supports_csv: boolean;
  sizes: SizePreset[];
  materials: MaterialOption[];
  quantity_limits: QuantityLimits;
  fromPrice: number | null;
}

export interface Division {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  products: ProductSummary[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  design: Design;
}

export interface Product {
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
  sizes: SizePreset[];
  size_limits: SizeLimits;
  materials: MaterialOption[];
  orientations: Orientation[];
  quantity_limits: QuantityLimits;
  pricing: ProductPricing;
  print_spec: PrintSpec;
  tiers: DiscountTier[];
  templates: Template[];
  vatRate: number;
  currency: string;
}

export interface CsvInfo {
  assetId: string;
  name: string;
  columns: string[];
  rowCount: number;
  rows: Record<string, string>[];
}

export interface ProofSummary {
  id: string;
  version: number;
  status: "pending" | "approved" | "changes_requested" | "superseded";
  source: string;
  customer_note: string | null;
  fit_report: { elementId: string; name: string; fontSize: number; tracking: number; shrunk: boolean }[];
  created_at: string;
  decided_at: string | null;
  has_preview: boolean;
  decided_by_email?: string | null;
}

export interface OrderListRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: "unpaid" | "paid" | "refunded";
  quantity: number;
  total_pence: number;
  currency: string;
  config: ProductConfig;
  created_at: string;
  paid_at: string | null;
  invoice_number: string | null;
  reorder_of: string | null;
  csv_row_count: number | null;
  product_name: string;
  product_slug: string;
  division_name: string;
  latest_proof: { id: string; version: number; status: ProofSummary["status"] } | null;
}

export interface OrderDetail {
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
  paid_at: string | null;
  invoice_number: string | null;
  files_ready: boolean;
  archived: boolean;
  reorder_of: string | null;
  customer_note: string | null;
  created_at: string;
  completed_at: string | null;
  product: { id: string; name: string; slug: string; print_spec: PrintSpec; materials: MaterialOption[]; supports_csv: boolean; division_name: string; division_slug?: string };
  proofs: ProofSummary[];
  history: { from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; created_at: string; actor_email?: string | null }[];
  approvals: { version: number; action: string; actor_email: string | null; note: string | null; created_at: string; ip?: string | null }[];
  reorderOfOrder: { id: string; order_number: string } | null;
  paymentsMode?: "stripe" | "test";
}
