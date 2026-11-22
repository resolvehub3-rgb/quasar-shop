-- ============================================================================
-- 003_rls_and_storage.sql
-- Strict Row Level Security (RLS) & Private Storage Bucket Policies
-- ============================================================================

-- Enable RLS on EVERY exposed table
ALTER TABLE public.owner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_qr_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Owner policies: Authenticated shop owner has full administrative access.
-- All cashier operations run exclusively through backend-verified API/Edge Functions
-- using the service role after cryptographic 6-digit PIN & session validation.
-- Anon users have ZERO direct SELECT/INSERT/UPDATE/DELETE access to any business table.

CREATE POLICY "Owner self profile read" ON public.owner_profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Owner self profile update" ON public.owner_profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Owner full access cashiers" ON public.cashiers
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner read cashier sessions" ON public.cashier_sessions
  FOR SELECT TO authenticated USING (public.is_shop_owner());

CREATE POLICY "Owner full access shop settings" ON public.shop_settings
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access categories" ON public.categories
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access measurement_units" ON public.measurement_units
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access products" ON public.products
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access product_unit_conversions" ON public.product_unit_conversions
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access product_barcodes" ON public.product_barcodes
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access suppliers" ON public.suppliers
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access purchases" ON public.purchases
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access purchase_items" ON public.purchase_items
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access supplier_payments" ON public.supplier_payments
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access cashier_shifts" ON public.cashier_shifts
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access cash_movements" ON public.cash_movements
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access sales" ON public.sales
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access sale_items" ON public.sale_items
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access payments" ON public.payments
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner read payment_webhook_events" ON public.payment_webhook_events
  FOR SELECT TO authenticated USING (public.is_shop_owner());

CREATE POLICY "Owner full access receipts" ON public.receipts
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access expense_categories" ON public.expense_categories
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner read expense_qr_sessions" ON public.expense_qr_sessions
  FOR SELECT TO authenticated USING (public.is_shop_owner());

CREATE POLICY "Owner full access expenses" ON public.expenses
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner read stock_movements" ON public.stock_movements
  FOR SELECT TO authenticated USING (public.is_shop_owner());

CREATE POLICY "Owner full access return_requests" ON public.return_requests
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner full access sms_configurations" ON public.sms_configurations
  FOR ALL TO authenticated USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

CREATE POLICY "Owner read sms_logs" ON public.sms_logs
  FOR SELECT TO authenticated USING (public.is_shop_owner());

CREATE POLICY "Owner read audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_shop_owner());

-- ============================================================================
-- SUPABASE STORAGE PRIVATE BUCKETS & POLICIES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('expense-evidence', 'expense-evidence', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('product-images', 'product-images', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Owner read expense evidence" ON storage.objects;
CREATE POLICY "Owner read expense evidence"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-evidence' AND public.is_shop_owner());

DROP POLICY IF EXISTS "Owner manage product images" ON storage.objects;
CREATE POLICY "Owner manage product images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'product-images' AND public.is_shop_owner())
  WITH CHECK (bucket_id = 'product-images' AND public.is_shop_owner());
