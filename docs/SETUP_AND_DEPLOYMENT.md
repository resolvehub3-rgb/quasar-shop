# Setup, Deployment & Testing Guide

## 1. Environment Variables
Copy `.env.example` to `.env` and populate your real credentials:
- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anon public key
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only Supabase service role key (NEVER expose to frontend)
- `CASHIER_SESSION_SECRET`: 32+ byte random hex string for cashier PIN fingerprinting
- `APP_URL`: Public URL of the deployed app (used for QR expense links)
- `MOOLRE_API_BASE_URL`: `https://api.moolre.com` (or `https://sandbox.moolre.com`)
- `MOOLRE_API_USER`, `MOOLRE_API_PUBKEY`, `MOOLRE_ACCOUNT_NUMBER`, `MOOLRE_WEBHOOK_SECRET`: Moolre merchant credentials
- `SASUSYNC_API_ENDPOINT`, `SASUSYNC_API_KEY`, `SASUSYNC_SENDER_ID`: SasuSync SMS gateway credentials (obtain from your SasuSync portal)
- `CRON_SECRET`: Shared secret for invoking scheduled SMS reports

## 2. Database Deployment (Supabase)
Execute the SQL migrations in order in your Supabase SQL Editor (or `supabase db push`):
1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_functions.sql`
3. `supabase/migrations/003_rls_and_storage.sql`
4. `supabase/migrations/004_cron_and_scheduled_reports.sql`

To enable 5-day / 7-day cloud scheduled SMS reports:
1. Deploy Edge Functions (`supabase functions deploy moolre-payment moolre-webhook sasusync-sms scheduled-reports`).
2. Set Edge Function secrets via `supabase secrets set ...`.
3. Enable `pg_cron` and `pg_net` in Supabase and run the `cron.schedule(...)` statement at the bottom of `004_cron_and_scheduled_reports.sql`.

## 3. Running & Building
- Install dependencies: `npm install`
- Run unit tests: `npx --yes tsx --test src/lib/inventoryMath.test.ts src/lib/posCalculations.test.ts`
- Development server (port 3000): `npm run dev`
- Production build: `npm run build`
- Production start: `NODE_ENV=production npm start`

## 4. Verification & Integration Matrix
- **Owner First-Run Setup**: Open `/`, switch to **First Setup**, register with email/password, shop name, and telephone number. Ownership locks permanently after the first owner is created.
- **Cashier Lifecycle**: Owner registers a cashier in `/owner/cashiers`, receives a one-time 6-digit PIN, cashier signs in at `/cashier/login` and opens a shift.
- **Moolre Webhook**: Configure your Moolre dashboard callback URL to `https://<your-domain>/api/payments/moolre/webhook` (or the `moolre-webhook` Edge Function).
- **SasuSync SMS**: Requires official SasuSync REST endpoint URL and API key before live SMS delivery can succeed; unconfigured attempts are recorded honestly as `blocked_missing_config` in `sms_logs`.
