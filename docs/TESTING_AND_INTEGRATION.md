# Testing & Integration Verification Guide

## 1. Automated Unit Tests (Pure Business Logic)

Pure inventory conversion, wholesale/retail pricing, POS cart totals, change due, shift variance, and payment state logic are decoupled from React and tested using `node:test`:

```bash
npx --yes tsx --test src/lib/inventoryMath.test.ts src/lib/posCalculations.test.ts
```

Covered assertions:
- Multi-unit conversion (`1 carton = 24 tins`, selling `24 tins` deducts `1` carton / `24` base units; partial sales calculate exact remaining whole cartons + loose units).
- Average unit cost weighting when receiving purchase orders.
- Low-stock and near-expiry classification thresholds.
- POS checkout validation (`amountTendered >= total`, split payments, discount caps, Mobile Money reference checks).
- Cashier shift cash variance calculation (`closingCash - expectedCash`).

## 2. TypeScript & Production Bundle Verification

```bash
npm run lint
npm run build
```

Both must exit with `0` errors. `vite-plugin-pwa` generates the Web App Manifest (`/manifest.webmanifest`) and Workbox service worker (`sw.js`) with offline app-shell caching while keeping `/api/*` and Supabase Auth/Database calls network-only so live inventory and payments are never stale.

## 3. Browser UI & Responsive Smoke Verification

Run the server (`npm run dev` on port `3000`) and verify with Playwright CLI across desktop (`1440x900`) and mobile (`390x844`):

- `/` Owner Authentication & First Setup: verifies honest Supabase connection status banner, segmented `Sign In` / `First Setup` toggle, form accessibility labels, and zero horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
- `/cashier/login` 6-Digit PIN Terminal: verifies 6-digit PIN entry via touch keypad, `Login` button disabled until 6 digits entered, server `/api/cashier/login` error handling when unconfigured, and zero overflow.
- `/expense-submit/:token` Single-Use QR Upload: verifies token validation on load, honest unavailable/expired state, and mobile-first layout.
- `/manifest.webmanifest` and PWA PNG icons (`/pwa-192x192.png`, `/pwa-512x512.png`, `/pwa-maskable-512x512.png`) return HTTP `200`.

## 4. End-to-End Integration Matrix (Requires Provisioned Environment)

Once Supabase, Moolre, and SasuSync credentials are configured in `.env` (or Supabase Edge Function secrets):

| Flow | Verification Steps | Expected Database / API Outcome |
|---|---|---|
| **Owner Bootstrap** | Open `/`, switch to `First Setup`, register owner email/password & shop name. | Creates `auth.users` record + 1 row in `owner_profiles` and `shop_settings`; subsequent `First Setup` attempts return `409 Conflict`. |
| **RLS Verification** | Query `products`, `sales`, `cashiers`, or `payments` using the Supabase `anon` key without an owner JWT or via a non-owner user JWT. | PostgreSQL RLS rejects read/write (`0 rows` / permission denied). |
| **Cashier Auth & Shift** | Owner creates cashier with 6-digit code in `/owner/cashiers`. Cashier signs in at `/cashier/login`, opens shift with opening cash, and tries 5 wrong codes. | Correct code returns `Bearer` token (`cashier_sessions`). `5` failed attempts lock the cashier for `15 minutes` and record an `audit_logs` entry. |
| **Multi-Unit POS Sale** | Purchase `10 cartons` (`24 pcs/carton` = `240 pcs` base stock). Sell `6 pcs` at retail and `1 carton` at wholesale via `fn_complete_sale`. | `products.stock_base_qty` atomically decreases to `210` (`8 cartons + 18 pcs`); `sales`, `sale_items`, `payments`, `receipts`, `stock_movements`, and `cash_movements` all commit in one transaction. |
| **Moolre Mobile Money** | Initiate MoMo checkout (`MTN` / `TELECEL` / `AT`) with live `MOOLRE_API_USER`, `MOOLRE_API_PUBKEY`, `MOOLRE_ACCOUNT_NUMBER`, and `MOOLRE_WEBHOOK_SECRET`. | `payments` row created as `pending`; signed webhook (`X-Moolre-Signature`) updates payment to `paid`, logs raw event in `payment_webhook_events` (`event_id` unique), and decrements stock idempotently via `fn_confirm_moolre_payment`. |
| **QR Expense Submission** | Cashier generates single-use QR token (`15m` expiry) during an open shift, scans from phone `/expense-submit/:token`, captures receipt photo & submits amount. | Image uploads to private `expense-evidence` bucket, `expenses` row + `cash_movements` created atomically, and `expense_qr_sessions.used_at` prevents reuse (`410 Gone` on second attempt). |
| **SasuSync SMS & Cron** | Configure `SASUSYNC_API_ENDPOINT` and `SASUSYNC_API_KEY`; trigger manual test in `/owner/sms` and verify `pg_cron` 5-day / 7-day schedules. | Dispatches real SMS via `SASUSYNC_API_ENDPOINT` and writes response payload + `sent`/`failed` status into `sms_logs`. |

## 5. Blocked External Integrations (Do Not Fake)

- **Moolre Live Transactions & Webhooks**: Endpoint contract (`https://api.moolre.com/open/transact/payment` + `X-Moolre-Signature`) is wired in both `server.ts` and `supabase/functions/moolre-*`, and stays disabled until merchant keys (`MOOLRE_API_USER`, `MOOLRE_API_PUBKEY`, `MOOLRE_ACCOUNT_NUMBER`, `MOOLRE_WEBHOOK_SECRET`) are supplied. Moolre collection API does not expose an automated merchant collection refund endpoint, so approved customer refunds settle via cash drawer or manual owner MoMo payout.
- **SasuSync SMS Delivery**: Public REST API documentation for `sms.sasusync.com` requires authenticated developer portal access. Live sending is gated behind `SASUSYNC_API_ENDPOINT` and `SASUSYNC_API_KEY` and logs `blocked_missing_config` in `sms_logs` rather than fabricating delivery.
