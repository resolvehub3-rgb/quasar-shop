-- ============================================================================
-- 004_cron_and_scheduled_reports.sql
-- Standard Measurement Units, Expense Categories & Cloud Cron Job Template
-- NOTE: Contains ONLY static lookup unit definitions and expense categories.
-- Contains ZERO mock products, ZERO fake transactions, ZERO demo records.
-- ============================================================================

INSERT INTO public.measurement_units (code, name, unit_type, allow_decimal)
VALUES
  ('pcs', 'Piece / Unit', 'count', FALSE),
  ('kg', 'Kilogram', 'weight', TRUE),
  ('g', 'Gram', 'weight', TRUE),
  ('l', 'Litre', 'volume', TRUE),
  ('ml', 'Millilitre', 'volume', TRUE),
  ('carton', 'Carton', 'pack', TRUE),
  ('crate', 'Crate', 'pack', TRUE),
  ('sack', 'Sack / Bag', 'pack', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.expense_categories (name)
VALUES
  ('Utilities & Electricity'),
  ('Transport & Delivery'),
  ('Store Supplies & Packaging'),
  ('Cleaning & Maintenance'),
  ('Airtime & Data'),
  ('Miscellaneous')
ON CONFLICT (name) DO NOTHING;

-- Enable Supabase Realtime on key operational tables for live owner dashboard updates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cashier_shifts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.return_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;

-- Cloud scheduled job template (requires pg_cron and pg_net extensions enabled in Supabase)
-- Evaluates daily at 19:00 UTC whether 5 days or 7 days have elapsed since last_scheduled_sent_at.
-- Replace <PROJECT_REF> and <CRON_SECRET> in Supabase SQL Editor when deploying to cloud.
/*
SELECT cron.schedule(
  'provision-shop-scheduled-sms-reports',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/scheduled-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
*/
