-- ============================================================================
-- 001_schema.sql
-- Complete Single-Shop Provision Shop Management System Database Schema
-- Target: Supabase PostgreSQL 15+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.owner_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cashiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  access_code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_fingerprint TEXT NOT NULL UNIQUE, -- HMAC-SHA256 deterministic hash to prevent duplicate active codes
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.owner_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cashier_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id UUID NOT NULL REFERENCES public.cashiers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. SHOP CONFIGURATION
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shop_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.owner_profiles(id) ON DELETE RESTRICT,
  shop_name TEXT NOT NULL DEFAULT 'Provision Shop',
  tagline TEXT DEFAULT 'Manage · Sell · Grow',
  phone TEXT,
  address TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  receipt_header TEXT DEFAULT 'Thank you for shopping with us!',
  receipt_footer TEXT DEFAULT 'Goods sold in good condition are subject to shop return policy.',
  thermal_paper_width TEXT NOT NULL DEFAULT '80mm' CHECK (thermal_paper_width IN ('58mm', '80mm')),
  max_cashier_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (max_cashier_discount_pct >= 0 AND max_cashier_discount_pct <= 100),
  allow_credit_sales BOOLEAN NOT NULL DEFAULT FALSE,
  refund_payment_policy TEXT NOT NULL DEFAULT 'unconfigured' CHECK (refund_payment_policy IN ('unconfigured', 'cash_only', 'match_original_or_cash', 'owner_selected')),
  moolre_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  moolre_supported_networks TEXT[] NOT NULL DEFAULT ARRAY['MTN', 'TELECEL', 'AT'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. PRODUCTS, CATEGORIES & SMART UNIT CONVERSIONS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.measurement_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('count', 'weight', 'volume', 'pack')),
  allow_decimal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  barcode TEXT UNIQUE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  description TEXT,
  purchase_cost NUMERIC(12,4) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
  selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  base_unit_id UUID NOT NULL REFERENCES public.measurement_units(id) ON DELETE RESTRICT,
  stock_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  min_stock_level NUMERIC(14,4) NOT NULL DEFAULT 5 CHECK (min_stock_level >= 0),
  damaged_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  expired_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (expired_quantity >= 0),
  image_path TEXT,
  expiry_date DATE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  conversion_to_base NUMERIC(14,6) NOT NULL CHECK (conversion_to_base > 0),
  selling_price NUMERIC(12,2) CHECK (selling_price IS NULL OR selling_price >= 0),
  is_purchase_unit BOOLEAN NOT NULL DEFAULT FALSE,
  is_sale_unit BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, unit_name)
);

CREATE TABLE IF NOT EXISTS public.product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL UNIQUE,
  unit_conversion_id UUID REFERENCES public.product_unit_conversions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. SUPPLIERS & PURCHASES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  notes TEXT,
  outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  invoice_reference TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  outstanding_balance NUMERIC(12,2) GENERATED ALWAYS AS (GREATEST(total_amount - amount_paid, 0)) STORED,
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES public.owner_profiles(id),
  notes TEXT,
  created_by UUID REFERENCES public.owner_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_unit_name TEXT NOT NULL,
  quantity_in_purchase_unit NUMERIC(14,4) NOT NULL CHECK (quantity_in_purchase_unit > 0),
  conversion_to_base NUMERIC(14,6) NOT NULL CHECK (conversion_to_base > 0),
  base_quantity NUMERIC(14,4) GENERATED ALWAYS AS (ROUND(quantity_in_purchase_unit * conversion_to_base, 4)) STORED,
  unit_cost_per_purchase_unit NUMERIC(12,4) NOT NULL CHECK (unit_cost_per_purchase_unit >= 0),
  base_unit_cost NUMERIC(12,4) GENERATED ALWAYS AS (ROUND(unit_cost_per_purchase_unit / conversion_to_base, 4)) STORED,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (ROUND(quantity_in_purchase_unit * unit_cost_per_purchase_unit, 2)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'momo', 'bank_transfer', 'cheque')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recorded_by UUID REFERENCES public.owner_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. CASHIER SHIFTS & CASH MOVEMENTS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_ref TEXT NOT NULL UNIQUE,
  cashier_id UUID NOT NULL REFERENCES public.cashiers(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_cash NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
  closed_at TIMESTAMPTZ,
  expected_cash NUMERIC(12,2),
  declared_cash NUMERIC(12,2),
  cash_discrepancy NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closing_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure at most one open shift per cashier
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift_per_cashier
  ON public.cashier_shifts (cashier_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES public.cashier_shifts(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'cash_sale', 'cash_expense', 'cash_refund', 'cash_in', 'cash_out', 'adjustment')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reference_id UUID,
  description TEXT NOT NULL,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('owner', 'cashier', 'system')),
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. SALES, PAYMENTS & RECEIPTS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  client_tx_ref TEXT NOT NULL UNIQUE, -- Idempotency key for online & offline sync
  shift_id UUID REFERENCES public.cashier_shifts(id) ON DELETE RESTRICT,
  cashier_id UUID REFERENCES public.cashiers(id) ON DELETE RESTRICT,
  owner_id UUID REFERENCES public.owner_profiles(id) ON DELETE RESTRICT,
  customer_name TEXT,
  customer_phone TEXT,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  change_given NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (change_given >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'refunded', 'partially_refunded', 'cancelled')),
  sync_source TEXT NOT NULL DEFAULT 'online' CHECK (sync_source IN ('online', 'offline_sync')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  sale_unit_name TEXT NOT NULL,
  quantity_in_sale_unit NUMERIC(14,4) NOT NULL CHECK (quantity_in_sale_unit > 0),
  conversion_to_base NUMERIC(14,6) NOT NULL CHECK (conversion_to_base > 0),
  base_quantity_deducted NUMERIC(14,4) NOT NULL CHECK (base_quantity_deducted > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  cost_basis_per_base_unit NUMERIC(12,4), -- NULL when purchase cost was not configured; never fabricate
  line_discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  payment_reference TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'momo')),
  provider TEXT NOT NULL DEFAULT 'cash' CHECK (provider IN ('cash', 'moolre')),
  network TEXT CHECK (network IS NULL OR network IN ('MTN', 'TELECEL', 'AT')),
  payer_phone TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  tendered_amount NUMERIC(12,2),
  change_amount NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'awaiting_authorization', 'processing', 'successful', 'failed', 'cancelled', 'expired')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_tx_id TEXT,
  failure_reason TEXT,
  callback_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'moolre',
  event_type TEXT NOT NULL,
  payment_reference TEXT,
  raw_payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  snapshot_json JSONB NOT NULL,
  reprint_count INTEGER NOT NULL DEFAULT 0,
  last_reprinted_at TIMESTAMPTZ,
  last_reprinted_by UUID REFERENCES public.owner_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. EXPENSES & QR CODE EVIDENCE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  cashier_id UUID NOT NULL REFERENCES public.cashiers(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.cashier_shifts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_ref TEXT NOT NULL UNIQUE,
  shift_id UUID REFERENCES public.cashier_shifts(id) ON DELETE SET NULL,
  cashier_id UUID REFERENCES public.cashiers(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES public.owner_profiles(id) ON DELETE SET NULL,
  qr_session_id UUID UNIQUE REFERENCES public.expense_qr_sessions(id) ON DELETE SET NULL,
  expense_name TEXT NOT NULL,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('cash_drawer', 'momo', 'other')),
  description TEXT,
  evidence_path TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'voided')),
  void_reason TEXT,
  voided_by UUID REFERENCES public.owner_profiles(id),
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 8. STOREBOOK — CHRONOLOGICAL STOCK MOVEMENT LEDGER
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  transaction_ref TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening_stock',
    'purchase_received',
    'sale',
    'approved_return',
    'damaged_stock',
    'expired_stock',
    'stock_adjustment',
    'other'
  )),
  description TEXT NOT NULL,
  stock_in NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (stock_in >= 0),
  stock_out NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (stock_out >= 0),
  running_balance NUMERIC(14,4) NOT NULL CHECK (running_balance >= 0),
  unit_cost_basis NUMERIC(12,4),
  source_table TEXT,
  source_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'cashier', 'system')),
  actor_id UUID,
  actor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 9. RETURNS & REFUNDS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_ref TEXT NOT NULL UNIQUE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  sale_item_id UUID NOT NULL REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  requested_by_cashier_id UUID REFERENCES public.cashiers(id) ON DELETE SET NULL,
  requested_by_owner_id UUID REFERENCES public.owner_profiles(id) ON DELETE SET NULL,
  quantity_returned NUMERIC(14,4) NOT NULL CHECK (quantity_returned > 0),
  base_quantity_returned NUMERIC(14,4) NOT NULL CHECK (base_quantity_returned > 0),
  reason TEXT NOT NULL,
  product_condition TEXT NOT NULL CHECK (product_condition IN ('resaleable', 'damaged', 'expired')),
  requested_refund_amount NUMERIC(12,2) NOT NULL CHECK (requested_refund_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_owner_id UUID REFERENCES public.owner_profiles(id),
  review_notes TEXT,
  refund_payment_method TEXT CHECK (refund_payment_method IS NULL OR refund_payment_method IN ('cash', 'momo_manual')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. SMS, SCHEDULED REPORTS & AUDIT LOGS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sms_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_phone TEXT NOT NULL DEFAULT '',
  sender_id TEXT NOT NULL DEFAULT '',
  notify_shift_open BOOLEAN NOT NULL DEFAULT TRUE,
  notify_shift_close BOOLEAN NOT NULL DEFAULT TRUE,
  notify_expense BOOLEAN NOT NULL DEFAULT TRUE,
  scheduled_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_frequency_days INTEGER NOT NULL DEFAULT 7 CHECK (scheduled_frequency_days IN (5, 7)),
  scheduled_destination_phone TEXT NOT NULL DEFAULT '',
  scheduled_sections JSONB NOT NULL DEFAULT '{"sales": true, "payment_breakdown": true, "expenses": true, "gross_profit": true, "items_sold": true, "low_stock": true, "supplier_balances": true}'::jsonb,
  last_scheduled_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('shift_open', 'shift_close', 'expense_submitted', 'scheduled_report', 'manual_test')),
  recipient_phone TEXT NOT NULL,
  message_body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'sasusync',
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'blocked_missing_config')),
  attempts INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  related_entity_type TEXT,
  related_entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'cashier', 'system')),
  actor_id UUID,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 11. PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_products_name ON public.products USING GIN (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category_id) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_products_expiry ON public.products (expiry_date) WHERE expiry_date IS NOT NULL AND is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON public.sales (shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON public.expenses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON public.expenses (shift_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_time ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_time ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON public.return_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
