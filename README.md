# Digital Heroes — Web-to-Print Platform

A full-stack web-to-print platform built for six print divisions: **Labels & Stickers**, **Race & Event Numbers**, **MTB Boards**, **Stamps**, **Trophies**, and **Laser-Cut Work**.

Customers configure parameter-driven products with live **INR (`₹`)** pricing and **18% GST**, design artwork directly in the browser (or upload print-ready files / CSVs for variable-data merges), pay via Stripe Checkout, review versioned proofs, and approve jobs for production. The studio manages every order through a dedicated admin console:

```text
QUOTE → ORDER → ARTWORK → PROOF → PRODUCTION → COMPLETED
```

---

## Tech Stack

### Frontend (`frontend/`)
- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **Styling & UI:** Tailwind CSS v4, Framer Motion, Lucide React, skeleton loading states
- **State Management:** Zustand (`useDraftStore` persisted to `localStorage`)
- **Authentication:** Email/password + Google Identity Services (`Continue with Google`)

### Backend (`backend/`)
- **Runtime & API:** Node.js 20+, Express 5, TypeScript
- **Database:** PostgreSQL on Supabase (`pg` connection pool, RLS enabled with deny-by-default public access)
- **File Storage:** Supabase Storage (private `print-files` bucket, with local `storage/` fallback)
- **Print & Proof Rendering Engine:** `fontkit` (vector text outlines from bundled TTF fonts), `pdf-lib` (vector PDFs with `TrimBox`/`BleedBox`), `sharp` (high-DPI PNG rasterization), `pdfjs-dist` (PDF preview rasterization), `archiver` (ZIP bundles for CSV batch jobs)
- **Payments:** Stripe Checkout + Webhook verification (with built-in test-payment fallback)
- **Email & Notifications:** Nodemailer (SMTP) with persistent `notifications` table log
- **Validation & Security:** Zod, `bcryptjs`, `jsonwebtoken` (JWT), Helmet, CORS, `express-rate-limit`

### Shared Engine (`backend/src/shared/` → `frontend/src/shared/`)
- `pricing.ts` — Integer-paisa area-based pricing, material multipliers, setup fees, volume discount tiers, and 18% GST calculation.
- `design.ts` — Millimetre-based layout model, 10 bundled fonts, safe-area/bleed bounds checking, shrink-to-fit text fitting, template scaling, and CSV column binding.

---

## Key Features

- **Parameter-Driven Catalogue:** Single product definitions cover preset sizes, custom dimensions (within admin-set min/max limits), materials, orientations, and quantity steps.
- **Live Price Calculator:** Instant unit and total pricing in **INR (`₹`)**, automatic volume-discount tiers (global or per-product), and **18% GST** breakdown.
- **In-Browser Designer:** Scaled templates, text/shapes/logos in millimetres, drag/resize/rotate, safe-area enforcement, automatic text shrink-to-fit, undo/redo, and server-rendered proof previews.
- **Variable-Data CSV Merge:** Upload a CSV, bind columns to text elements, preview any row, and validate text fit across all rows before ordering.
- **Artwork Upload:** Supports PNG, JPG, SVG, PDF, and PDF-compatible `.ai` files (up to 4 MB).
- **Proof Approval Gate:** Versioned proofs (`v1`, `v2`, …) generated automatically after payment. Print files (vector PDF + high-DPI PNG, or per-row/all-rows PDFs + ZIP for CSV jobs) are generated only after customer approval.
- **Customer Account (`/account`):** Dashboard, order tracking, proof approval & change requests, PDF invoices, saved designs, and one-click reorders.
- **Admin Production Console (`/admin`):** Overview KPIs, searchable/filterable job database, proof regeneration & studio uploads, ZIP downloads, pipeline status transitions, product/tier/template/gallery/user management, revenue reports with Xero-compatible CSV export, and outbound email logs.

---

## Project Structure

```text
├── backend/
│   ├── api/index.ts              # Vercel serverless entry point
│   ├── assets/fonts/             # Bundled TTF fonts for proof & print rendering
│   ├── scripts/sync-shared.mjs   # Copies shared pricing/design engine to frontend
│   ├── supabase/schema.sql       # Complete PostgreSQL schema (15 tables + RLS)
│   └── src/
│       ├── app.ts                # Express app (Helmet, CORS, Stripe webhook, routes)
│       ├── config/               # Zod-validated env config & PostgreSQL pool
│       ├── middleware/           # JWT auth & admin guards
│       ├── routes/               # public, auth, customer, admin
│       ├── scripts/              # migrate, seed, createAdmin
│       ├── services/             # orders, render, assets, storage, payments, email, invoice, csv
│       └── shared/               # Source-of-truth pricing.ts & design.ts
└── frontend/
    └── src/
        ├── app/                  # Storefront, calculator, designer, checkout, account, admin
        ├── components/           # UI primitives, skeleton loaders, configurator, designer, Google button
        ├── lib/                  # API client, auth context, Zustand draft store, hooks, formatting
        └── shared/               # Synced copy of backend/src/shared/
```

---

## Local Setup

### 1. Requirements
- **Node.js 20+**
- A **Supabase** project (PostgreSQL + Storage)
- Optional: **Google OAuth Client ID**, **Stripe** test keys, **SMTP** credentials

### 2. Install Dependencies
```powershell
cd backend
npm install

cd ../frontend
npm install
```

### 3. Configure Environment Variables

Copy `backend/.env.example` to `backend/.env`:
```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000

DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-or-secret-key>
STORAGE_BUCKET=print-files

JWT_SECRET=<64-char-random-hex>
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>

STRIPE_SECRET_KEY=<sk_test_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email>
SMTP_PASS=<your-app-password>
MAIL_FROM=Digital Heroes <your-email>
ADMIN_NOTIFY_EMAIL=<studio-inbox-email>

VAT_RATE=0.18
CURRENCY=INR

ADMIN_EMAIL=admin@digitalheroes.co.in
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Studio Admin
```

Copy `frontend/.env.example` to `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
```

### 4. Migrate, Seed & Create Admin
From `backend/`:
```powershell
npm run db:setup
npm run create-admin
```
- `npm run db:setup` applies `supabase/schema.sql` (15 tables) and seeds 6 divisions, 9 products, discount tiers, templates, and 16 rendered gallery images into Supabase Storage.
- `npm run create-admin` creates or resets the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### 5. Run Locally
```powershell
# Terminal 1 — API (http://localhost:4000)
cd backend
npm run dev

# Terminal 2 — Storefront (http://localhost:3000)
cd frontend
npm run dev
```

---

## Useful Scripts

| Workspace | Script | Description |
| --- | --- | --- |
| `backend` | `npm run dev` | Start API in watch mode on port `4000` |
| `backend` | `npm run typecheck` | Run TypeScript typecheck |
| `backend` | `npm run build` / `npm start` | Compile to `dist/` and run production server |
| `backend` | `npm run db:migrate` | Apply `supabase/schema.sql` |
| `backend` | `npm run db:seed` | Seed catalogue, templates, and gallery images |
| `backend` | `npm run db:setup` | Run migrate + seed |
| `backend` | `npm run create-admin` | Create or reset admin account |
| `backend` | `npm run sync:shared` | Sync `backend/src/shared/*` to `frontend/src/shared/` |
| `frontend` | `npm run dev` | Start Next.js dev server on port `3000` |
| `frontend` | `npm run build` / `npm start` | Build and run Next.js production server |
| `frontend` | `npm run lint` | Run ESLint |

---

## Deployment (Vercel)

Deploy `backend/` and `frontend/` as two separate Vercel projects from this repository:
1. **Backend project:** Set Root Directory to `backend`, add all backend environment variables (`DATABASE_URL` using the Supabase Transaction Pooler on port `6543`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `FRONTEND_URL`, `VAT_RATE=0.18`, `CURRENCY=INR`, plus optional Stripe/SMTP/Google keys).
2. **Frontend project:** Set Root Directory to `frontend`, add `NEXT_PUBLIC_API_URL` (pointing to your deployed backend URL) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
3. Add your deployed frontend URL to `FRONTEND_URL` on the backend and to **Authorized JavaScript origins** in Google Cloud Console if using Google Sign-In.
