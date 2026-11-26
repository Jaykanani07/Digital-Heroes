# Digital Heroes — web-to-print platform

A full-stack web-to-print site for six print divisions (labels & stickers, race & event numbers,
MTB boards, stamps, trophies, laser-cut work). Customers configure a product with a live price,
design it in the browser (or upload artwork / a CSV for variable data), pay, review a proof and
approve it. The studio runs every job through a production console:

`QUOTE → ORDER → ARTWORK → PROOF → PRODUCTION → COMPLETED`

| Folder | What it is | Stack |
| --- | --- | --- |
| `frontend/` | Storefront, designer, customer account, admin console | Next.js 15 (App Router), React 19, Tailwind v4 |
| `backend/` | REST API, pricing, rendering of proofs and print files | Node.js, Express 5, TypeScript, PostgreSQL (Supabase), Supabase Storage |

The full database schema is in [backend/supabase/schema.sql](backend/supabase/schema.sql).

---

## 1. Requirements

- Node.js 20 or newer (tested with 22)
- A PostgreSQL database: a Supabase project (recommended) or a local PostgreSQL 15+
- Optional: Stripe test keys, SMTP credentials (both have built-in fallbacks, see below)

## 2. Install

```powershell
cd backend
npm install
```

```powershell
cd frontend
npm install
```

## 3. Configure the backend

Copy `backend/.env.example` to `backend/.env` and fill it in. Every variable is documented inside
the file. The minimum to run is:

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres.xxxx:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres` | Supabase → Project Settings → Database → Connection string |
| `JWT_SECRET` | 64+ random characters | Signs login tokens |
| `FRONTEND_URL` | `http://localhost:3000` | Comma separated if more than one (CORS, e-mail links, Stripe redirects) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@yourdomain.com` / at least 8 characters | Used by `npm run create-admin` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Project Settings → API | Leave empty locally to store files in `backend/storage/` |

**Fallbacks.** These keep everything working before you have accounts:

- No `STRIPE_SECRET_KEY`: the checkout runs in **test-payment mode**, with a "Pay now (test mode)" button and no card is charged.
- No `SMTP_HOST`: e-mails are printed to the API console and saved in the e-mail log (Admin → E-mail log).
- No `SUPABASE_URL`: files are stored on disk in `backend/storage/`.

## 4. Create the database, demo data and admin

Run these from `backend/`:

```powershell
npm run db:setup
```

This runs `supabase/schema.sql`, then seeds 6 divisions, 9 products, volume-discount tiers,
12 templates and 16 gallery images. Both steps are safe to re-run. You can also paste
`schema.sql` into the Supabase SQL editor instead of `npm run db:migrate`, but run
`npm run db:seed` afterwards: the seed renders the gallery images and uploads them to Storage.

```powershell
npm run create-admin
```

This creates the administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`. Run it again
at any time to reset that admin's password.

## 5. Configure the frontend

Copy `frontend/.env.example` to `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## 6. Run locally

```powershell
cd backend; npm run dev
```

```powershell
cd frontend; npm run dev
```

Open <http://localhost:3000>. Sign in with the admin account and open **Admin** for the
production console, or register a new customer account to place orders.

## 7. Useful scripts

| Where | Script | What it does |
| --- | --- | --- |
| backend | `npm run dev` | API with auto-reload on port 4000 |
| backend | `npm run build` / `npm start` | Compile to `dist/` and run it |
| backend | `npm run typecheck` | Type-check without building |
| backend | `npm run db:migrate` | Apply `supabase/schema.sql` |
| backend | `npm run db:seed` | Insert the demo catalogue, templates and gallery |
| backend | `npm run db:setup` | Migrate, then seed |
| backend | `npm run create-admin` | Create or reset the admin account from `.env` |
| backend | `npm run sync:shared` | Copy `backend/src/shared/*` (design and pricing engine) to `frontend/src/shared/` |
| frontend | `npm run dev` / `npm run build` / `npm start` | Next.js |

> The design and pricing engine (`design.ts`, `pricing.ts`) is shared by both apps so the price
> and text fitting the customer sees in the browser match the server exactly. Edit the copy in
> `backend/src/shared/`, then run `npm run sync:shared`.

## 8. What is where

```
backend/
  api/index.ts              Vercel serverless entry
  assets/fonts/             Fonts embedded in proofs and print PDFs
  supabase/schema.sql       Complete database schema
  src/app.ts                Express app (security headers, CORS, routes)
  src/config/               Environment validation, database pool
  src/routes/               public, auth, customer, admin
  src/services/             orders (pipeline), render (PDF/PNG), payments, invoice, storage, email, csv
  src/shared/               design + pricing engine shared with the frontend
  src/scripts/              migrate, seed, createAdmin
frontend/
  src/app/                  Pages (storefront, designer, account, admin)
  src/components/           UI kit, configurator, designer, site chrome
  src/lib/                  API client, auth, hooks, formatting
  src/shared/               Copy of the backend engine (generated, see sync:shared)
```

## 9. Feature checklist

- **Catalogue.** Six divisions and parameter-driven products: one product covers every size,
  material, orientation and quantity, with custom sizes inside admin-set limits.
- **Live pricing.** Area-based unit price × material multiplier, automatic volume-discount tiers
  (global or per product), GST, and a "next tier" nudge. The calculator page needs no account.
- **Designer.** Templates scaled to the chosen size; text, shapes and images in millimetres;
  drag, resize and rotate; elements kept inside the safe area; text shrinks to fit; undo/redo;
  keyboard shortcuts; a server-rendered proof preview.
- **Variable data.** CSV upload, column binding, a preview of any row, and a fit check across
  every row before ordering.
- **Artwork upload.** PNG, JPG, SVG, PDF and PDF-compatible AI files.
- **Orders.** Checkout through Stripe or test mode. Proofs are issued automatically after
  payment and versioned v1, v2 and so on. The customer approves or requests changes. Print files
  are only generated after approval (the approval gate).
- **Print files.** Vector PDF with TrimBox/BleedBox, plus a PNG at product DPI. A CSV job produces
  one PDF per row in a zip plus an all-rows PDF. Files are named
  `OrderID_ProductType_Date_Output` and stored per order.
- **Customer account.** Dashboard, orders, proof review, invoices (PDF), one-click reorder
  (approved artwork goes straight to production), saved designs and profile.
- **Admin console.** Overview, a job database with filters and search, job detail (proofs,
  uploads, regenerating files, a zip of all files, status moves with notes, archive), products
  and discount tiers, templates (in the designer), gallery, users, reports with an Xero CSV
  export, and the e-mail log.
- **Notifications.** E-mails on order, proof issued, changes requested, approval and completion,
  to the customer and the studio inbox.
