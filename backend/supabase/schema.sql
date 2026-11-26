-- =====================================================================
-- Digital Heroes — web-to-print platform schema (PostgreSQL / Supabase)
--
-- Run once in the Supabase SQL editor, or with `npm run db:migrate`.
-- The script is idempotent: it can be re-run safely on an existing DB.
--
-- Security model: the browser never talks to the database directly.
-- Every request goes through the Node.js API, which connects with the
-- server-side connection string. Row Level Security is therefore enabled
-- on every table with NO policies, so the public anon/authenticated
-- PostgREST roles cannot read or write anything (deny-by-default).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
do $$ begin
  create type user_role as enum ('customer', 'admin');
exception when duplicate_object then null; end $$;

-- The production pipeline from the PRD (§11):
-- QUOTE → ORDER → ARTWORK → PROOF → PRODUCTION → COMPLETED
do $$ begin
  create type order_status as enum ('quote', 'order', 'artwork', 'proof', 'production', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid', 'paid', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type proof_status as enum ('pending', 'approved', 'changes_requested', 'superseded');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------- helper trigger
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -------------------------------------------------------- organisations
-- Scalability (§14): groundwork for corporate / multi-account ordering.
-- Every user and order can belong to an organisation; unused for now.
create table if not exists organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- users
create table if not exists users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,                 -- stored lower-case
  password_hash    text not null,                        -- bcrypt
  full_name        text not null,
  phone            text,
  company          text,
  role             user_role not null default 'customer',
  organisation_id  uuid references organisations(id) on delete set null,
  is_active        boolean not null default true,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint users_email_lower check (email = lower(email))
);
drop trigger if exists users_updated_at on users;
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

-- ------------------------------------------------------------ divisions
-- The six print divisions. New divisions are rows, not code (§14).
create table if not exists divisions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  tagline      text not null default '',
  description  text not null default '',
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------- products
-- Parameter-driven products (§04): ONE row models every size / material /
-- orientation / quantity variant. No per-dimension SKUs.
--
-- sizes           [{ "label": "A5", "w": 148, "h": 210 }]          (mm, portrait)
-- size_limits     { "allowCustom": true, "minW": 20, "maxW": 300, "minH": 20, "maxH": 300 }
-- materials       [{ "key": "vinyl", "label": "White vinyl", "multiplier": 1, "description": "" }]
-- orientations    ["portrait", "landscape"]
-- quantity_limits { "min": 10, "max": 10000, "step": 1 }
-- pricing         { "baseUnit": 0.12, "perCm2": 0.004, "minUnit": 0.1, "setupFee": 0 }  (GBP, net of VAT)
-- print_spec      { "bleedMm": 3, "safeMm": 3, "dpi": 300, "cornerRadiusMm": 0 }
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  division_id      uuid not null references divisions(id) on delete restrict,
  slug             text not null unique,
  name             text not null,
  summary          text not null default '',
  description      text not null default '',
  is_active        boolean not null default true,
  supports_csv     boolean not null default false,
  sizes            jsonb not null default '[]'::jsonb,
  size_limits      jsonb not null default '{}'::jsonb,
  materials        jsonb not null default '[]'::jsonb,
  orientations     jsonb not null default '["portrait","landscape"]'::jsonb,
  quantity_limits  jsonb not null default '{"min":1,"max":10000,"step":1}'::jsonb,
  pricing          jsonb not null default '{}'::jsonb,
  print_spec       jsonb not null default '{"bleedMm":3,"safeMm":3,"dpi":300}'::jsonb,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists products_division_idx on products(division_id);
drop trigger if exists products_updated_at on products;
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

-- ------------------------------------------------------- discount tiers
-- Automatic volume discounts (§05). product_id NULL = global default tiers;
-- a product with its own tiers ignores the global ones.
create table if not exists discount_tiers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products(id) on delete cascade,
  min_qty       int not null check (min_qty > 0),
  discount_pct  numeric(5,2) not null check (discount_pct >= 0 and discount_pct < 100),
  created_at    timestamptz not null default now()
);
create unique index if not exists discount_tiers_unique
  on discount_tiers (coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), min_qty);

-- ------------------------------------------------------------ templates
-- Template groups per product. `design` is a Design document (see
-- backend/src/shared/design.ts) authored at a base size and scaled to the
-- customer's chosen size.
create table if not exists templates (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  design       jsonb not null,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists templates_product_idx on templates(product_id);

-- --------------------------------------------------------------- assets
-- Every uploaded file (logos, finished artwork, CSV data, gallery images).
-- storage_path points into Supabase Storage (or the local dev folder).
create table if not exists assets (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references users(id) on delete cascade,
  kind           text not null check (kind in ('logo', 'artwork', 'csv', 'gallery')),
  original_name  text not null,
  mime           text not null,
  size_bytes     int not null,
  storage_path   text not null,
  png_path       text,              -- raster version used by the renderer
  width_px       int,
  height_px      int,
  meta           jsonb not null default '{}'::jsonb,  -- csv columns / row count, pdf page size …
  created_at     timestamptz not null default now()
);
create index if not exists assets_owner_idx on assets(owner_id);

-- -------------------------------------------------------------- designs
-- Saved designs (§09): artwork stored against the account for reuse.
create table if not exists designs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  product_id        uuid not null references products(id) on delete cascade,
  name              text not null,
  config            jsonb not null,           -- { widthMm, heightMm, material, orientation, quantity }
  design            jsonb,                    -- Design document (null when artwork was uploaded)
  artwork_asset_id  uuid references assets(id) on delete set null,
  csv_asset_id      uuid references assets(id) on delete set null,
  thumbnail_path    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists designs_user_idx on designs(user_id);
drop trigger if exists designs_updated_at on designs;
create trigger designs_updated_at before update on designs
  for each row execute function set_updated_at();

-- --------------------------------------------------------------- orders
-- One order = one production job (one configured product). This keeps the
-- production pipeline, proofs and print files 1:1 with a job ticket.
create sequence if not exists order_number_seq start 1001;
create sequence if not exists invoice_number_seq start 5001;

create table if not exists orders (
  id                   uuid primary key default gen_random_uuid(),
  order_number         text not null unique default ('DH-' || nextval('order_number_seq')),
  user_id              uuid not null references users(id) on delete restrict,
  organisation_id      uuid references organisations(id) on delete set null,
  product_id           uuid not null references products(id) on delete restrict,
  design_id            uuid references designs(id) on delete set null,
  status               order_status not null default 'quote',
  payment_status       payment_status not null default 'unpaid',
  config               jsonb not null,        -- snapshot of the configuration
  design_snapshot      jsonb,                 -- snapshot of the artwork at order time
  artwork_asset_id     uuid references assets(id) on delete set null,
  csv_asset_id         uuid references assets(id) on delete set null,
  csv_row_count        int,
  quantity             int not null check (quantity > 0),
  unit_price_net       numeric(12,4) not null,  -- before discount, GBP
  discount_pct         numeric(5,2) not null default 0,
  gross_pence          int not null,           -- unit × qty, net of VAT
  discount_pence       int not null default 0,
  setup_pence          int not null default 0,
  subtotal_pence       int not null,           -- net of VAT, after discount
  vat_rate             numeric(5,4) not null,
  vat_pence            int not null,
  total_pence          int not null,           -- VAT inclusive
  currency             text not null default 'INR',
  stripe_session_id    text,
  stripe_payment_ref   text,
  paid_at              timestamptz,
  invoice_number       text unique,
  files_ready          boolean not null default false,  -- approval gate (§08)
  archived             boolean not null default false,
  archived_at          timestamptz,
  completed_at         timestamptz,
  reorder_of           uuid references orders(id) on delete set null,
  customer_note        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists orders_user_idx on orders(user_id);
create index if not exists orders_status_idx on orders(status);
create index if not exists orders_product_idx on orders(product_id);
create index if not exists orders_created_idx on orders(created_at desc);
drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- Every pipeline move is logged.
create table if not exists order_status_history (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  from_status  order_status,
  to_status    order_status not null,
  actor_id     uuid references users(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists osh_order_idx on order_status_history(order_id);

-- --------------------------------------------------------------- proofs
-- Versioned proofs (§08): v1, v2 … per order.
create table if not exists proofs (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  version           int not null,
  status            proof_status not null default 'pending',
  source            text not null check (source in ('designer', 'upload', 'admin_upload', 'reorder')),
  design_snapshot   jsonb,
  artwork_asset_id  uuid references assets(id) on delete set null,
  preview_path      text,      -- PNG with trim / safe-area guides (null for PDF artwork)
  pdf_path          text,      -- proof PDF (exactly what will be printed)
  fit_report        jsonb not null default '[]'::jsonb,
  customer_note     text,      -- change request text
  created_by        uuid references users(id) on delete set null,
  decided_by        uuid references users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (order_id, version)
);

-- Approval log: who approved which version and when.
create table if not exists approval_logs (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  proof_id     uuid references proofs(id) on delete cascade,
  version      int,
  action       text not null check (action in ('issued', 'approved', 'changes_requested', 'auto_approved')),
  actor_id     uuid references users(id) on delete set null,
  actor_email  text,
  note         text,
  ip           text,
  created_at   timestamptz not null default now()
);
create index if not exists approval_logs_order_idx on approval_logs(order_id);

-- ---------------------------------------------------------- print files
-- Production output (§07). Only created after a proof is approved.
-- Naming: OrderID_ProductType_Date_Output, grouped per order directory.
create table if not exists print_files (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  proof_id      uuid references proofs(id) on delete set null,
  kind          text not null check (kind in ('print_pdf', 'print_png', 'csv_pdf', 'csv_zip')),
  filename      text not null,
  storage_path  text not null,
  size_bytes    int not null,
  rows          int,
  created_at    timestamptz not null default now()
);
create index if not exists print_files_order_idx on print_files(order_id);

-- -------------------------------------------------------------- gallery
create table if not exists gallery_items (
  id            uuid primary key default gen_random_uuid(),
  division_id   uuid not null references divisions(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  image_path    text not null,
  is_published  boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------- notifications
-- Outbound e-mail log (order updates, proof status, completion alerts).
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  order_id    uuid references orders(id) on delete set null,
  to_email    text not null,
  subject     text not null,
  body        text not null,
  status      text not null check (status in ('sent', 'logged', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------- row level security
alter table organisations        enable row level security;
alter table users                enable row level security;
alter table divisions            enable row level security;
alter table products             enable row level security;
alter table discount_tiers       enable row level security;
alter table templates            enable row level security;
alter table assets               enable row level security;
alter table designs              enable row level security;
alter table orders               enable row level security;
alter table order_status_history enable row level security;
alter table proofs               enable row level security;
alter table approval_logs        enable row level security;
alter table print_files          enable row level security;
alter table gallery_items        enable row level security;
alter table notifications        enable row level security;
