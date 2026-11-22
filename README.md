# Qusar-Shop

A production-ready single-shop inventory, Point of Sale (POS), Mobile Money, SMS reporting, and accounting management system built as an installable Progressive Web Application (PWA).

---

## Overview

**Qusar-Shop** is designed for one physical provision shop with two strictly separated operational roles:

1. **Shop Owner (Super Admin)** — Full administrative control over products, multi-unit packaging conversions, supplier purchases & balances, real-time sales analytics, Storebook profit & expense reporting, return/refund approvals, cashier management, shift cash audits, SMS notifications, and shop settings.
2. **Cashier (POS Terminal)** — Fast counter checkout interface authenticated via a server-verified **6-digit access code**, with mandatory shift opening cash declaration, barcode scanning, wholesale/retail unit selection, Cash / Moolre Mobile Money / Split payments, offline cash-sale queue, single-use QR expense evidence submission, and end-of-shift cash reconciliation.

All persistent business records are stored in **Supabase PostgreSQL** and protected by **Row Level Security (RLS)** and transactional database functions—no mock, dummy, or hardcoded business data is used anywhere.

---

## Core Features

- **Multi-Unit Inventory & Pricing**: Track stock in base units (e.g. `pcs`, `kg`, `l`) with configurable wholesale/retail unit conversions (e.g. `1 carton = 24 pcs`), automatic unit cost derivation, barcode aliases, low-stock alerts, and expiry tracking.
- **POS & Thermal/PDF Receipts**: Fast search and camera barcode scanning (`html5-qrcode`), unit switcher, cash tendered/change calculation, Moolre MoMo & split payments, 58mm/80mm thermal receipt printing, and PDF receipt export (`jspdf`).
- **Purchases & Supplier Ledger**: Record purchase orders, receive stock into inventory atomically (`fn_receive_purchase`), track partial/full supplier payments (`fn_record_supplier_payment`), and monitor outstanding balances.
- **Cashier Shifts & Drawer Reconciliation**: Server-hashed (`scrypt` + HMAC fingerprint) 6-digit cashier PINs, rate-limiting & 5-attempt lockout, opening cash float, real-time drawer tracking, and closing variance reporting (`fn_close_cashier_shift`).
- **Single-Use QR Expense Evidence**: Cashiers generate a time-limited (`15 min`) QR link during an open shift and upload receipt photos from a smartphone (`/expense-submit/:token`) directly into a private Supabase Storage bucket (`expense-evidence`).
- **Moolre Mobile Money & SasuSync SMS**: Server-side Moolre payment initiation and HMAC-SHA256 webhook verification (`X-Moolre-Signature`), plus SasuSync SMS alert triggers (shift open/close, expenses, and 5-day / 7-day scheduled reports).
- **Exports & Storebook Analytics**: Real-time Supabase Realtime updates, Storebook profit/margin reports, and CSV, Excel (`.xlsx`), and PDF exports.
- **Installable PWA**: Web App Manifest, custom icons, Workbox app-shell caching, and an IndexedDB/localStorage offline cash-sale queue.

---

## Tech Stack

- **Frontend**: React 19, Vite 8, TypeScript, Tailwind CSS v4, React Router, Lucide React
- **Backend Server**: Express (`server.ts` via `tsx`) serving `/api/*` routes and Vite/static assets on port `3000`
- **Database, Auth, Storage & Realtime**: Supabase (PostgreSQL, Auth, Realtime, Private Storage, RLS, Edge Functions)
- **External Integrations**: Moolre API (Mobile Money), SasuSync API (SMS)
- **Utilities**: `html5-qrcode`, `qrcode`, `jspdf`, `jspdf-autotable`, `xlsx`, `vite-plugin-pwa`

---

## Project Structure

```text
├── docs/
│   ├── DATABASE_SCHEMA.md          # Entity relationships & RPC documentation
│   ├── SETUP_AND_DEPLOYMENT.md     # Environment & Supabase deployment instructions
│   └── TESTING_AND_INTEGRATION.md  # Unit, browser, and E2E verification guide
├── public/                         # PWA icons & uploaded static assets
├── src/
│   ├── components/                 # OwnerLayout, ReceiptModal, CameraBarcodeScannerModal, PWAInstallButton
│   ├── lib/                        # supabaseClient, inventoryMath, posCalculations, offlineQueue, exportUtils & unit tests
│   ├── pages/
│   │   ├── OwnerAuthPage.tsx       # Shop owner sign-in & first-run setup (/)
│   │   ├── CashierLoginPage.tsx    # 6-digit cashier keypad login (/cashier/login)
│   │   ├── CashierPosPage.tsx      # Shift-gated Cashier POS (/cashier/pos)
│   │   ├── ExpenseSubmitMobilePage.tsx # Single-use QR expense upload (/expense-submit/:token)
│   │   └── owner/                  # Dashboard, Owner POS, Products, Purchases/Suppliers, Sales/Expenses/Storebook, Admin/Reports
│   └── types/database.ts           # Shared TypeScript domain interfaces
├── supabase/
│   ├── functions/                  # Edge Functions: moolre-payment, moolre-webhook, sasusync-sms, scheduled-reports
│   └── migrations/                 # Ordered SQL schema, RPC functions, RLS/storage, and cron templates (001–004)
├── server.ts                       # Express API & Vite SSR/SPA host on port 3000
├── vite.config.ts                  # Vite + VitePWA configuration
└── .env.example                    # Environment variable template
```

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Server-only Supabase service role key (never expose to browser code)
- `CASHIER_SESSION_SECRET` — Random 32+ byte hex secret for cashier PIN fingerprinting
- `APP_URL` — Public base URL (used for QR expense links and callbacks)

Optional external integration variables:
- **Moolre Mobile Money**: `MOOLRE_API_BASE_URL`, `MOOLRE_API_USER`, `MOOLRE_API_PUBKEY`, `MOOLRE_ACCOUNT_NUMBER`, `MOOLRE_WEBHOOK_SECRET`
- **SasuSync SMS**: `SASUSYNC_API_ENDPOINT`, `SASUSYNC_API_KEY`, `SASUSYNC_SENDER_ID`
- **Scheduled Reports**: `CRON_SECRET`

### 3. Provision Supabase Database & Edge Functions

Run the SQL migrations in order inside your Supabase SQL Editor (or via `supabase db push`):

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_functions.sql`
3. `supabase/migrations/003_rls_and_storage.sql`
4. `supabase/migrations/004_cron_and_scheduled_reports.sql`

To deploy Edge Functions and enable 5-day / 7-day scheduled SMS reports, see [`docs/SETUP_AND_DEPLOYMENT.md`](./docs/SETUP_AND_DEPLOYMENT.md).

### 4. Run Locally

```bash
npm run dev
```

The application and API server start on `http://localhost:3000`.

- On first launch, open `/` and select **First Setup** to create the single authorized Shop Owner account.
- Once signed in, create cashiers under **Cashiers** to generate 6-digit login codes for `/cashier/login`.

---

## Scripts & Testing

| Command | Purpose |
|---|---|
| `npm run dev` | Start Express + Vite dev server on port `3000` |
| `npm run lint` | Run TypeScript type check (`tsc --noEmit`) |
| `npm run build` | Build production bundle and PWA assets into `dist/` |
| `NODE_ENV=production npm start` | Serve built production app and API via `server.ts` |
| `npx --yes tsx --test src/lib/inventoryMath.test.ts src/lib/posCalculations.test.ts` | Run unit tests for inventory math and POS/shift calculations |

---

## Additional Documentation

- [`docs/DATABASE_SCHEMA.md`](./docs/DATABASE_SCHEMA.md) — Schema overview, triggers, and transactional RPC functions
- [`docs/SETUP_AND_DEPLOYMENT.md`](./docs/SETUP_AND_DEPLOYMENT.md) — Supabase, Moolre, SasuSync, and deployment guide
- [`docs/TESTING_AND_INTEGRATION.md`](./docs/TESTING_AND_INTEGRATION.md) — Unit tests, verification matrix, and integration requirements
