-- ============================================================================
-- 002_functions.sql
-- Atomic PostgreSQL Functions, Triggers, Stock Ledger & Cash Reconciliation
-- ============================================================================

-- Helper: updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'owner_profiles', 'cashiers', 'shop_settings', 'categories',
    'products', 'suppliers', 'purchases', 'cashier_shifts',
    'sales', 'payments', 'expenses', 'return_requests',
    'sms_configurations', 'sms_logs'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();', t, t);
  END LOOP;
END;
$$;

-- Helper: Check whether the current Supabase auth user is the registered shop owner
CREATE OR REPLACE FUNCTION public.is_shop_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.owner_profiles WHERE id = auth.uid()
  );
$$;

-- ============================================================================
-- 1. OPEN CASHIER SHIFT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_open_cashier_shift(
  p_cashier_id UUID,
  p_opening_cash NUMERIC
)
RETURNS public.cashier_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cashier public.cashiers%ROWTYPE;
  v_existing_open UUID;
  v_shift_ref TEXT;
  v_shift public.cashier_shifts%ROWTYPE;
BEGIN
  IF p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative';
  END IF;

  SELECT * INTO v_cashier FROM public.cashiers WHERE id = p_cashier_id;
  IF NOT FOUND OR v_cashier.status <> 'active' THEN
    RAISE EXCEPTION 'Cashier account is inactive or does not exist';
  END IF;

  SELECT id INTO v_existing_open
  FROM public.cashier_shifts
  WHERE cashier_id = p_cashier_id AND status = 'open';

  IF FOUND THEN
    RAISE EXCEPTION 'Cashier already has an open shift';
  END IF;

  v_shift_ref := 'SHF-' || TO_CHAR(NOW(), 'YYMMDD-HH24MISS') || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);

  INSERT INTO public.cashier_shifts (shift_ref, cashier_id, opening_cash, status)
  VALUES (v_shift_ref, p_cashier_id, ROUND(p_opening_cash, 2), 'open')
  RETURNING * INTO v_shift;

  INSERT INTO public.cash_movements (
    shift_id, movement_type, amount, reference_id, description, created_by_type, created_by_id
  ) VALUES (
    v_shift.id, 'opening', ROUND(p_opening_cash, 2), v_shift.id,
    'Shift opened with declared opening cash', 'cashier', p_cashier_id
  );

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'cashier', p_cashier_id, v_cashier.full_name, 'SHIFT_OPENED', 'cashier_shifts', v_shift.id,
    jsonb_build_object('shift_ref', v_shift_ref, 'opening_cash', v_shift.opening_cash)
  );

  RETURN v_shift;
END;
$$;

-- ============================================================================
-- 2. CLOSE CASHIER SHIFT & COMPUTE CASH RECONCILIATION
-- Formula: Opening Cash + Cash Sales - Cash Drawer Expenses + Cash In - Cash Out - Cash Refunds
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_close_cashier_shift(
  p_shift_id UUID,
  p_cashier_id UUID,
  p_declared_cash NUMERIC,
  p_closing_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.cashier_shifts%ROWTYPE;
  v_cashier public.cashiers%ROWTYPE;
  v_cash_sales NUMERIC(12,2) := 0;
  v_momo_sales NUMERIC(12,2) := 0;
  v_cash_expenses NUMERIC(12,2) := 0;
  v_momo_expenses NUMERIC(12,2) := 0;
  v_other_expenses NUMERIC(12,2) := 0;
  v_cash_refunds NUMERIC(12,2) := 0;
  v_other_cash_in NUMERIC(12,2) := 0;
  v_other_cash_out NUMERIC(12,2) := 0;
  v_expected_cash NUMERIC(12,2) := 0;
  v_discrepancy NUMERIC(12,2) := 0;
  v_tx_count INTEGER := 0;
  v_expense_count INTEGER := 0;
BEGIN
  IF p_declared_cash < 0 THEN
    RAISE EXCEPTION 'Declared cash cannot be negative';
  END IF;

  SELECT * INTO v_shift FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.cashier_id <> p_cashier_id THEN
    RAISE EXCEPTION 'Unauthorized shift closure attempt';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift is already closed';
  END IF;

  SELECT * INTO v_cashier FROM public.cashiers WHERE id = p_cashier_id;

  -- Cash & MoMo sales settled in this shift (net of change given for cash)
  SELECT
    COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.status = 'successful' THEN p.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'momo' AND p.status = 'successful' THEN p.amount ELSE 0 END), 0)
  INTO v_cash_sales, v_momo_sales
  FROM public.payments p
  JOIN public.sales s ON s.id = p.sale_id
  WHERE s.shift_id = p_shift_id AND s.payment_status IN ('paid', 'partial', 'refunded', 'partially_refunded');

  SELECT COUNT(*) INTO v_tx_count
  FROM public.sales
  WHERE shift_id = p_shift_id AND payment_status IN ('paid', 'refunded', 'partially_refunded');

  -- Expenses grouped by source
  SELECT
    COALESCE(SUM(CASE WHEN payment_source = 'cash_drawer' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_source = 'momo' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_source = 'other' THEN amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_cash_expenses, v_momo_expenses, v_other_expenses, v_expense_count
  FROM public.expenses
  WHERE shift_id = p_shift_id AND status = 'recorded';

  -- Cash refunds & manual adjustments
  SELECT
    COALESCE(SUM(CASE WHEN movement_type = 'cash_refund' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END), 0)
  INTO v_cash_refunds, v_other_cash_in, v_other_cash_out
  FROM public.cash_movements
  WHERE shift_id = p_shift_id;

  v_expected_cash := ROUND(
    v_shift.opening_cash + v_cash_sales - v_cash_expenses - v_cash_refunds + v_other_cash_in - v_other_cash_out,
    2
  );
  v_discrepancy := ROUND(p_declared_cash - v_expected_cash, 2);

  UPDATE public.cashier_shifts
  SET
    closed_at = NOW(),
    expected_cash = v_expected_cash,
    declared_cash = ROUND(p_declared_cash, 2),
    cash_discrepancy = v_discrepancy,
    status = 'closed',
    closing_notes = p_closing_notes
  WHERE id = p_shift_id;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'cashier', p_cashier_id, v_cashier.full_name, 'SHIFT_CLOSED', 'cashier_shifts', p_shift_id,
    jsonb_build_object(
      'shift_ref', v_shift.shift_ref,
      'expected_cash', v_expected_cash,
      'declared_cash', ROUND(p_declared_cash, 2),
      'discrepancy', v_discrepancy,
      'cash_sales', v_cash_sales,
      'momo_sales', v_momo_sales
    )
  );

  RETURN jsonb_build_object(
    'shift_id', v_shift.id,
    'shift_ref', v_shift.shift_ref,
    'cashier_name', v_cashier.full_name,
    'opening_cash', v_shift.opening_cash,
    'cash_sales', v_cash_sales,
    'momo_sales', v_momo_sales,
    'cash_expenses', v_cash_expenses,
    'momo_expenses', v_momo_expenses,
    'other_expenses', v_other_expenses,
    'cash_refunds', v_cash_refunds,
    'expected_cash', v_expected_cash,
    'declared_cash', ROUND(p_declared_cash, 2),
    'cash_discrepancy', v_discrepancy,
    'transaction_count', v_tx_count,
    'expense_count', v_expense_count
  );
END;
$$;

-- ============================================================================
-- 3. RECEIVE PURCHASE ORDER (ONLY CONFIRMED RECEIPT INCREMENTS INVENTORY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_receive_purchase(
  p_purchase_id UUID,
  p_owner_id UUID
)
RETURNS public.purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_owner public.owner_profiles%ROWTYPE;
  v_item RECORD;
  v_new_balance NUMERIC(14,4);
  v_unpaid NUMERIC(12,2);
BEGIN
  SELECT * INTO v_owner FROM public.owner_profiles WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the authorized shop owner can confirm received purchases';
  END IF;

  SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;
  IF v_purchase.status = 'received' THEN
    RAISE EXCEPTION 'Purchase has already been marked as received';
  END IF;
  IF v_purchase.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled purchase cannot be received';
  END IF;

  -- Increment stock for each item and write Storebook movement ledger
  FOR v_item IN
    SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    UPDATE public.products
    SET
      stock_quantity = ROUND(stock_quantity + v_item.base_quantity, 4),
      purchase_cost = v_item.base_unit_cost
    WHERE id = v_item.product_id
    RETURNING stock_quantity INTO v_new_balance;

    INSERT INTO public.stock_movements (
      product_id, transaction_ref, movement_type, description,
      stock_in, stock_out, running_balance, unit_cost_basis,
      source_table, source_id, actor_type, actor_id, actor_name
    ) VALUES (
      v_item.product_id,
      v_purchase.purchase_number,
      'purchase_received',
      format('Received %s %s (Purchase %s)', v_item.quantity_in_purchase_unit, v_item.purchase_unit_name, v_purchase.purchase_number),
      v_item.base_quantity,
      0,
      v_new_balance,
      v_item.base_unit_cost,
      'purchases',
      v_purchase.id,
      'owner',
      p_owner_id,
      v_owner.full_name
    );
  END LOOP;

  v_unpaid := GREATEST(v_purchase.total_amount - v_purchase.amount_paid, 0);
  IF v_unpaid > 0 THEN
    UPDATE public.suppliers
    SET outstanding_balance = ROUND(outstanding_balance + v_unpaid, 2)
    WHERE id = v_purchase.supplier_id;
  END IF;

  UPDATE public.purchases
  SET status = 'received', received_at = NOW(), received_by = p_owner_id
  WHERE id = p_purchase_id
  RETURNING * INTO v_purchase;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'owner', p_owner_id, v_owner.full_name, 'PURCHASE_RECEIVED', 'purchases', v_purchase.id,
    jsonb_build_object('purchase_number', v_purchase.purchase_number, 'total_amount', v_purchase.total_amount, 'unpaid_balance', v_unpaid)
  );

  RETURN v_purchase;
END;
$$;

-- ============================================================================
-- 4. RECORD SUPPLIER PAYMENT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_notes TEXT,
  p_owner_id UUID
)
RETURNS public.supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.owner_profiles%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_payment public.supplier_payments%ROWTYPE;
  v_ref TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_owner FROM public.owner_profiles WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the authorized shop owner can record supplier payments';
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  IF p_amount > v_supplier.outstanding_balance THEN
    RAISE EXCEPTION 'Payment amount exceeds supplier outstanding balance';
  END IF;

  v_ref := 'SPAY-' || TO_CHAR(NOW(), 'YYMMDD-HH24MISS') || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);

  INSERT INTO public.supplier_payments (
    supplier_id, purchase_id, payment_reference, amount, payment_method, notes, recorded_by
  ) VALUES (
    p_supplier_id, p_purchase_id, v_ref, ROUND(p_amount, 2), p_payment_method, p_notes, p_owner_id
  ) RETURNING * INTO v_payment;

  UPDATE public.suppliers
  SET outstanding_balance = GREATEST(ROUND(outstanding_balance - p_amount, 2), 0)
  WHERE id = p_supplier_id;

  IF p_purchase_id IS NOT NULL THEN
    UPDATE public.purchases
    SET amount_paid = LEAST(total_amount, ROUND(amount_paid + p_amount, 2))
    WHERE id = p_purchase_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'owner', p_owner_id, v_owner.full_name, 'SUPPLIER_PAYMENT', 'supplier_payments', v_payment.id,
    jsonb_build_object('supplier_id', p_supplier_id, 'amount', p_amount, 'method', p_payment_method)
  );

  RETURN v_payment;
END;
$$;

-- ============================================================================
-- 5. COMPLETE OR INITIATE SALE ATOMICALLY
-- Authoritative backend pricing, conversion validation, stock deduction,
-- COGS snapshot, payment records, cash movement, and receipt generation.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_complete_sale(
  p_client_tx_ref TEXT,
  p_shift_id UUID,
  p_cashier_id UUID,
  p_owner_id UUID,
  p_items JSONB,
  p_discount_amount NUMERIC DEFAULT 0,
  p_cash_amount NUMERIC DEFAULT 0,
  p_cash_tendered NUMERIC DEFAULT 0,
  p_momo_amount NUMERIC DEFAULT 0,
  p_sync_source TEXT DEFAULT 'online',
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_sale public.sales%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_settings public.shop_settings%ROWTYPE;
  v_actor_name TEXT;
  v_actor_type TEXT;
  v_actor_id UUID;
  v_receipt_no TEXT;
  v_sale_id UUID;
  v_subtotal NUMERIC(12,2) := 0;
  v_total NUMERIC(12,2) := 0;
  v_cash_applied NUMERIC(12,2) := 0;
  v_change NUMERIC(12,2) := 0;
  v_payment_status TEXT := 'pending';
  v_item JSONB;
  v_product public.products%ROWTYPE;
  v_conv public.product_unit_conversions%ROWTYPE;
  v_unit_name TEXT;
  v_conv_factor NUMERIC(14,6);
  v_unit_price NUMERIC(12,2);
  v_qty NUMERIC(14,4);
  v_base_deduct NUMERIC(14,4);
  v_line_total NUMERIC(12,2);
  v_new_balance NUMERIC(14,4);
  v_receipt_items JSONB := '[]'::jsonb;
  v_payment_breakdown JSONB := '[]'::jsonb;
  v_max_discount NUMERIC(12,2);
BEGIN
  -- 1. Idempotency check (prevents duplicate sales / double deductions on retry or offline sync)
  SELECT * INTO v_existing_sale FROM public.sales WHERE client_tx_ref = p_client_tx_ref;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale.id,
      'receipt_number', v_existing_sale.receipt_number,
      'payment_status', v_existing_sale.payment_status,
      'total_amount', v_existing_sale.total_amount,
      'paid_amount', v_existing_sale.paid_amount,
      'change_given', v_existing_sale.change_given,
      'duplicate_prevented', TRUE
    );
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  SELECT * INTO v_settings FROM public.shop_settings LIMIT 1;

  IF p_cashier_id IS NOT NULL THEN
    SELECT s.* INTO v_shift FROM public.cashier_shifts s WHERE s.id = p_shift_id AND s.cashier_id = p_cashier_id AND s.status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active open shift is required for cashier sales';
    END IF;
    SELECT full_name INTO v_actor_name FROM public.cashiers WHERE id = p_cashier_id;
    v_actor_type := 'cashier';
    v_actor_id := p_cashier_id;
  ELSIF p_owner_id IS NOT NULL THEN
    SELECT full_name INTO v_actor_name FROM public.owner_profiles WHERE id = p_owner_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Owner profile not found';
    END IF;
    v_actor_type := 'owner';
    v_actor_id := p_owner_id;
  ELSE
    RAISE EXCEPTION 'Authenticated cashier or owner is required';
  END IF;

  -- 2. First pass: validate stock & compute authoritative subtotal from database
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_product.is_archived THEN
      RAISE EXCEPTION 'Product % is unavailable or archived', v_item->>'product_id';
    END IF;

    v_qty := (v_item->>'quantity')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive for %', v_product.name;
    END IF;

    IF (v_item->>'conversion_id') IS NOT NULL AND (v_item->>'conversion_id') <> '' THEN
      SELECT * INTO v_conv
      FROM public.product_unit_conversions
      WHERE id = (v_item->>'conversion_id')::UUID AND product_id = v_product.id AND is_sale_unit = TRUE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid sale unit conversion for %', v_product.name;
      END IF;
      v_unit_name := v_conv.unit_name;
      v_conv_factor := v_conv.conversion_to_base;
      v_unit_price := COALESCE(v_conv.selling_price, ROUND(v_product.selling_price * v_conv.conversion_to_base, 2));
    ELSE
      SELECT code INTO v_unit_name FROM public.measurement_units WHERE id = v_product.base_unit_id;
      v_conv_factor := 1;
      v_unit_price := v_product.selling_price;
    END IF;

    v_base_deduct := ROUND(v_qty * v_conv_factor, 4);
    IF v_product.stock_quantity < v_base_deduct THEN
      RAISE EXCEPTION 'Insufficient stock for % (available: %, requested: %)', v_product.name, v_product.stock_quantity, v_base_deduct;
    END IF;

    v_line_total := ROUND(v_qty * v_unit_price, 2);
    v_subtotal := ROUND(v_subtotal + v_line_total, 2);
  END LOOP;

  -- 3. Validate discount authorization
  IF p_discount_amount < 0 OR p_discount_amount > v_subtotal THEN
    RAISE EXCEPTION 'Invalid discount amount';
  END IF;

  IF v_actor_type = 'cashier' AND v_settings.id IS NOT NULL THEN
    v_max_discount := ROUND(v_subtotal * (v_settings.max_cashier_discount_pct / 100.0), 2);
    IF p_discount_amount > v_max_discount THEN
      RAISE EXCEPTION 'Discount exceeds authorized cashier limit (% %%)', v_settings.max_cashier_discount_pct;
    END IF;
  END IF;

  v_total := ROUND(v_subtotal - p_discount_amount, 2);
  v_cash_applied := ROUND(GREATEST(p_cash_amount, 0), 2);

  IF v_cash_applied > 0 AND p_cash_tendered < v_cash_applied THEN
    RAISE EXCEPTION 'Cash tendered cannot be less than cash payment component';
  END IF;

  IF v_cash_applied > 0 THEN
    v_change := ROUND(GREATEST(p_cash_tendered - v_cash_applied, 0), 2);
  END IF;

  IF ROUND(v_cash_applied + GREATEST(p_momo_amount, 0), 2) < v_total THEN
    RAISE EXCEPTION 'Payment components do not cover total amount (%)', v_total;
  END IF;

  -- Cash-only completes immediately; if MoMo component > 0, sale stays pending/partial until Moolre confirms
  IF GREATEST(p_momo_amount, 0) = 0 AND v_cash_applied >= v_total THEN
    v_payment_status := 'paid';
  ELSIF v_cash_applied > 0 THEN
    v_payment_status := 'partial';
  ELSE
    v_payment_status := 'pending';
  END IF;

  v_receipt_no := 'RCP-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));

  INSERT INTO public.sales (
    receipt_number, client_tx_ref, shift_id, cashier_id, owner_id,
    customer_name, customer_phone, subtotal, discount_amount, total_amount,
    paid_amount, change_given, payment_status, sync_source,
    completed_at
  ) VALUES (
    v_receipt_no, p_client_tx_ref, p_shift_id, p_cashier_id, p_owner_id,
    p_customer_name, p_customer_phone, v_subtotal, ROUND(p_discount_amount, 2), v_total,
    v_cash_applied, v_change, v_payment_status, p_sync_source,
    CASE WHEN v_payment_status = 'paid' THEN NOW() ELSE NULL END
  ) RETURNING id INTO v_sale_id;

  -- 4. Second pass: insert sale_items, deduct stock ONLY when paid immediately (or reserve on pending MoMo? Wait: deduct immediately when paid; for pending MoMo, deduct on confirmation OR hold & prevent double deduction)
  -- To keep stock strictly consistent with completed sales, we deduct stock only when paid, OR if split/MoMo pending we validate stock again on confirmation.
  -- Let's insert sale_items now and deduct stock when v_payment_status = 'paid' (and fn_confirm_moolre_payment deducts stock atomically on MoMo confirmation!).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;

    IF (v_item->>'conversion_id') IS NOT NULL AND (v_item->>'conversion_id') <> '' THEN
      SELECT * INTO v_conv FROM public.product_unit_conversions WHERE id = (v_item->>'conversion_id')::UUID;
      v_unit_name := v_conv.unit_name;
      v_conv_factor := v_conv.conversion_to_base;
      v_unit_price := COALESCE(v_conv.selling_price, ROUND(v_product.selling_price * v_conv.conversion_to_base, 2));
    ELSE
      SELECT code INTO v_unit_name FROM public.measurement_units WHERE id = v_product.base_unit_id;
      v_conv_factor := 1;
      v_unit_price := v_product.selling_price;
    END IF;

    v_base_deduct := ROUND(v_qty * v_conv_factor, 4);
    v_line_total := ROUND(v_qty * v_unit_price, 2);

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, sale_unit_name,
      quantity_in_sale_unit, conversion_to_base, base_quantity_deducted,
      unit_price, cost_basis_per_base_unit, line_total
    ) VALUES (
      v_sale_id, v_product.id, v_product.name, v_unit_name,
      v_qty, v_conv_factor, v_base_deduct,
      v_unit_price, v_product.purchase_cost, v_line_total
    );

    IF v_payment_status = 'paid' THEN
      UPDATE public.products
      SET stock_quantity = ROUND(stock_quantity - v_base_deduct, 4)
      WHERE id = v_product.id
      RETURNING stock_quantity INTO v_new_balance;

      INSERT INTO public.stock_movements (
        product_id, transaction_ref, movement_type, description,
        stock_in, stock_out, running_balance, unit_cost_basis,
        source_table, source_id, actor_type, actor_id, actor_name
      ) VALUES (
        v_product.id, v_receipt_no, 'sale',
        format('Sold %s %s (%s)', v_qty, v_unit_name, v_receipt_no),
        0, v_base_deduct, v_new_balance, v_product.purchase_cost,
        'sales', v_sale_id, v_actor_type, v_actor_id, v_actor_name
      );
    END IF;

    v_receipt_items := v_receipt_items || jsonb_build_object(
      'product_name', v_product.name,
      'unit_name', v_unit_name,
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_total', v_line_total
    );
  END LOOP;

  -- 5. Record cash payment component if > 0
  IF v_cash_applied > 0 THEN
    INSERT INTO public.payments (
      sale_id, payment_reference, method, provider, amount,
      tendered_amount, change_amount, status, idempotency_key,
      callback_verified, verified_at
    ) VALUES (
      v_sale_id, 'CASH-' || v_receipt_no, 'cash', 'cash', v_cash_applied,
      ROUND(p_cash_tendered, 2), v_change, 'successful', 'cash-' || p_client_tx_ref,
      TRUE, NOW()
    );

    IF p_shift_id IS NOT NULL THEN
      INSERT INTO public.cash_movements (
        shift_id, movement_type, amount, reference_id, description, created_by_type, created_by_id
      ) VALUES (
        p_shift_id, 'cash_sale', v_cash_applied, v_sale_id,
        'Cash sale ' || v_receipt_no, v_actor_type, v_actor_id
      );
    END IF;

    v_payment_breakdown := v_payment_breakdown || jsonb_build_object(
      'method', 'cash',
      'amount', v_cash_applied,
      'tendered', ROUND(p_cash_tendered, 2),
      'change', v_change
    );
  END IF;

  -- 6. Generate digital receipt immediately when fully paid
  IF v_payment_status = 'paid' THEN
    INSERT INTO public.receipts (sale_id, receipt_number, snapshot_json)
    VALUES (
      v_sale_id,
      v_receipt_no,
      jsonb_build_object(
        'receipt_number', v_receipt_no,
        'client_tx_ref', p_client_tx_ref,
        'date', NOW(),
        'cashier_name', v_actor_name,
        'items', v_receipt_items,
        'subtotal', v_subtotal,
        'discount', ROUND(p_discount_amount, 2),
        'total', v_total,
        'payments', v_payment_breakdown,
        'change_given', v_change
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_number', v_receipt_no,
    'payment_status', v_payment_status,
    'subtotal', v_subtotal,
    'discount_amount', ROUND(p_discount_amount, 2),
    'total_amount', v_total,
    'paid_amount', v_cash_applied,
    'change_given', v_change,
    'momo_due', GREATEST(v_total - v_cash_applied, 0),
    'duplicate_prevented', FALSE
  );
END;
$$;

-- ============================================================================
-- 6. CONFIRM MOOLRE PAYMENT (WEBHOOK OR VERIFIED POLLING)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_confirm_moolre_payment(
  p_payment_reference TEXT,
  p_provider_tx_id TEXT,
  p_new_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_total_confirmed NUMERIC(12,2);
  v_item RECORD;
  v_new_balance NUMERIC(14,4);
  v_actor_name TEXT;
  v_actor_type TEXT;
  v_actor_id UUID;
  v_receipt_items JSONB := '[]'::jsonb;
  v_payment_breakdown JSONB := '[]'::jsonb;
  v_pay RECORD;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE payment_reference = p_payment_reference FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment reference % not found', p_payment_reference;
  END IF;

  -- Idempotency: if already finalized as successful, return immediately
  IF v_payment.status = 'successful' THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_payment.sale_id;
    RETURN jsonb_build_object('already_confirmed', TRUE, 'sale_id', v_sale.id, 'payment_status', v_sale.payment_status);
  END IF;

  IF p_new_status IN ('failed', 'cancelled', 'expired') THEN
    UPDATE public.payments
    SET status = p_new_status, failure_reason = p_failure_reason, provider_tx_id = COALESCE(p_provider_tx_id, provider_tx_id)
    WHERE id = v_payment.id;

    RETURN jsonb_build_object('already_confirmed', FALSE, 'sale_id', v_payment.sale_id, 'payment_status', p_new_status);
  END IF;

  IF p_new_status <> 'successful' THEN
    UPDATE public.payments
    SET status = p_new_status, provider_tx_id = COALESCE(p_provider_tx_id, provider_tx_id)
    WHERE id = v_payment.id;
    RETURN jsonb_build_object('already_confirmed', FALSE, 'sale_id', v_payment.sale_id, 'payment_status', p_new_status);
  END IF;

  -- Mark MoMo payment successful
  UPDATE public.payments
  SET
    status = 'successful',
    provider_tx_id = COALESCE(p_provider_tx_id, provider_tx_id),
    callback_verified = TRUE,
    verified_at = NOW()
  WHERE id = v_payment.id;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_payment.sale_id FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_confirmed
  FROM public.payments
  WHERE sale_id = v_sale.id AND status = 'successful';

  IF v_total_confirmed >= v_sale.total_amount AND v_sale.payment_status <> 'paid' THEN
    IF v_sale.cashier_id IS NOT NULL THEN
      SELECT full_name INTO v_actor_name FROM public.cashiers WHERE id = v_sale.cashier_id;
      v_actor_type := 'cashier';
      v_actor_id := v_sale.cashier_id;
    ELSE
      SELECT full_name INTO v_actor_name FROM public.owner_profiles WHERE id = v_sale.owner_id;
      v_actor_type := 'owner';
      v_actor_id := v_sale.owner_id;
    END IF;

    -- Deduct stock & record Storebook movements atomically
    FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = v_sale.id
    LOOP
      UPDATE public.products
      SET stock_quantity = ROUND(stock_quantity - v_item.base_quantity_deducted, 4)
      WHERE id = v_item.product_id AND stock_quantity >= v_item.base_quantity_deducted
      RETURNING stock_quantity INTO v_new_balance;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock during MoMo settlement for %', v_item.product_name;
      END IF;

      INSERT INTO public.stock_movements (
        product_id, transaction_ref, movement_type, description,
        stock_in, stock_out, running_balance, unit_cost_basis,
        source_table, source_id, actor_type, actor_id, actor_name
      ) VALUES (
        v_item.product_id, v_sale.receipt_number, 'sale',
        format('Sold %s %s (%s)', v_item.quantity_in_sale_unit, v_item.sale_unit_name, v_sale.receipt_number),
        0, v_item.base_quantity_deducted, v_new_balance, v_item.cost_basis_per_base_unit,
        'sales', v_sale.id, v_actor_type, v_actor_id, v_actor_name
      );

      v_receipt_items := v_receipt_items || jsonb_build_object(
        'product_name', v_item.product_name,
        'unit_name', v_item.sale_unit_name,
        'quantity', v_item.quantity_in_sale_unit,
        'unit_price', v_item.unit_price,
        'line_total', v_item.line_total
      );
    END LOOP;

    FOR v_pay IN SELECT * FROM public.payments WHERE sale_id = v_sale.id AND status = 'successful'
    LOOP
      v_payment_breakdown := v_payment_breakdown || jsonb_build_object(
        'method', v_pay.method,
        'network', v_pay.network,
        'amount', v_pay.amount,
        'reference', v_pay.payment_reference
      );
    END LOOP;

    UPDATE public.sales
    SET paid_amount = v_total_confirmed, payment_status = 'paid', completed_at = NOW()
    WHERE id = v_sale.id;

    INSERT INTO public.receipts (sale_id, receipt_number, snapshot_json)
    VALUES (
      v_sale.id,
      v_sale.receipt_number,
      jsonb_build_object(
        'receipt_number', v_sale.receipt_number,
        'client_tx_ref', v_sale.client_tx_ref,
        'date', NOW(),
        'cashier_name', v_actor_name,
        'items', v_receipt_items,
        'subtotal', v_sale.subtotal,
        'discount', v_sale.discount_amount,
        'total', v_sale.total_amount,
        'payments', v_payment_breakdown,
        'change_given', v_sale.change_given
      )
    )
    ON CONFLICT (sale_id) DO NOTHING;
  ELSE
    UPDATE public.sales
    SET paid_amount = v_total_confirmed, payment_status = 'partial'
    WHERE id = v_sale.id;
  END IF;

  RETURN jsonb_build_object('already_confirmed', FALSE, 'sale_id', v_sale.id, 'paid_amount', v_total_confirmed, 'receipt_number', v_sale.receipt_number);
END;
$$;

-- ============================================================================
-- 7. SUBMIT QR EXPENSE (SINGLE-USE EXPIRING TOKEN VALIDATION)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_submit_qr_expense(
  p_token_hash TEXT,
  p_expense_name TEXT,
  p_category_name TEXT,
  p_amount NUMERIC,
  p_payment_source TEXT,
  p_description TEXT,
  p_evidence_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr public.expense_qr_sessions%ROWTYPE;
  v_cashier public.cashiers%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_cat_id UUID;
  v_exp_ref TEXT;
  v_expense public.expenses%ROWTYPE;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;
  IF p_payment_source NOT IN ('cash_drawer', 'momo', 'other') THEN
    RAISE EXCEPTION 'Invalid expense payment source';
  END IF;

  SELECT * INTO v_qr FROM public.expense_qr_sessions WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid QR expense session';
  END IF;
  IF v_qr.status <> 'active' THEN
    RAISE EXCEPTION 'This QR expense link has already been used or cancelled';
  END IF;
  IF v_qr.expires_at < NOW() THEN
    UPDATE public.expense_qr_sessions SET status = 'expired' WHERE id = v_qr.id;
    RAISE EXCEPTION 'This QR expense link has expired';
  END IF;

  SELECT * INTO v_shift FROM public.cashier_shifts WHERE id = v_qr.shift_id;
  SELECT * INTO v_cashier FROM public.cashiers WHERE id = v_qr.cashier_id;

  SELECT id INTO v_cat_id FROM public.expense_categories WHERE LOWER(name) = LOWER(p_category_name) LIMIT 1;

  v_exp_ref := 'EXP-' || TO_CHAR(NOW(), 'YYMMDD-HH24MISS') || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);

  UPDATE public.expense_qr_sessions
  SET status = 'used', used_at = NOW()
  WHERE id = v_qr.id;

  INSERT INTO public.expenses (
    expense_ref, shift_id, cashier_id, qr_session_id,
    expense_name, category_id, category_name, amount,
    payment_source, description, evidence_path, status
  ) VALUES (
    v_exp_ref, v_qr.shift_id, v_qr.cashier_id, v_qr.id,
    p_expense_name, v_cat_id, p_category_name, ROUND(p_amount, 2),
    p_payment_source, p_description, p_evidence_path, 'recorded'
  ) RETURNING * INTO v_expense;

  -- Only cash_drawer expenses reduce expected cash in the drawer
  IF p_payment_source = 'cash_drawer' THEN
    INSERT INTO public.cash_movements (
      shift_id, movement_type, amount, reference_id, description, created_by_type, created_by_id
    ) VALUES (
      v_qr.shift_id, 'cash_expense', ROUND(p_amount, 2), v_expense.id,
      'Drawer expense: ' || p_expense_name, 'cashier', v_qr.cashier_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'cashier', v_qr.cashier_id, v_cashier.full_name, 'EXPENSE_SUBMITTED_QR', 'expenses', v_expense.id,
    jsonb_build_object('expense_ref', v_exp_ref, 'amount', v_expense.amount, 'payment_source', p_payment_source, 'shift_ref', v_shift.shift_ref)
  );

  RETURN jsonb_build_object(
    'expense_id', v_expense.id,
    'expense_ref', v_exp_ref,
    'cashier_name', v_cashier.full_name,
    'shift_ref', v_shift.shift_ref,
    'amount', v_expense.amount,
    'payment_source', p_payment_source,
    'category_name', p_category_name,
    'expense_name', p_expense_name
  );
END;
$$;

-- ============================================================================
-- 8. OWNER REVIEW OF RETURN & REFUND REQUEST
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_review_return_request(
  p_return_id UUID,
  p_owner_id UUID,
  p_decision TEXT,
  p_refund_payment_method TEXT DEFAULT NULL,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS public.return_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.owner_profiles%ROWTYPE;
  v_ret public.return_requests%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_new_balance NUMERIC(14,4);
  v_movement_type TEXT;
BEGIN
  SELECT * INTO v_owner FROM public.owner_profiles WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the authorized shop owner can approve or reject refunds';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT * INTO v_ret FROM public.return_requests WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return request not found';
  END IF;
  IF v_ret.status <> 'pending' THEN
    RAISE EXCEPTION 'Return request has already been reviewed';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.return_requests
    SET status = 'rejected', reviewed_by_owner_id = p_owner_id, review_notes = p_review_notes, reviewed_at = NOW()
    WHERE id = p_return_id
    RETURNING * INTO v_ret;

    INSERT INTO public.audit_logs (
      actor_type, actor_id, actor_name, action, entity_type, entity_id, details
    ) VALUES (
      'owner', p_owner_id, v_owner.full_name, 'REFUND_REJECTED', 'return_requests', v_ret.id,
      jsonb_build_object('refund_ref', v_ret.refund_ref, 'notes', p_review_notes)
    );
    RETURN v_ret;
  END IF;

  IF p_refund_payment_method IS NULL OR p_refund_payment_method NOT IN ('cash', 'momo_manual') THEN
    RAISE EXCEPTION 'Approved refund requires explicit refund payment method (cash or momo_manual)';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_ret.sale_id;

  -- Stock is ONLY restored when product_condition = 'resaleable'. Damaged/expired tracked separately!
  IF v_ret.product_condition = 'resaleable' THEN
    UPDATE public.products
    SET stock_quantity = ROUND(stock_quantity + v_ret.base_quantity_returned, 4)
    WHERE id = v_ret.product_id
    RETURNING stock_quantity INTO v_new_balance;

    INSERT INTO public.stock_movements (
      product_id, transaction_ref, movement_type, description,
      stock_in, stock_out, running_balance,
      source_table, source_id, actor_type, actor_id, actor_name
    ) VALUES (
      v_ret.product_id, v_ret.refund_ref, 'approved_return',
      format('Approved resaleable return (%s) for sale %s', v_ret.refund_ref, v_sale.receipt_number),
      v_ret.base_quantity_returned, 0, v_new_balance,
      'return_requests', v_ret.id, 'owner', p_owner_id, v_owner.full_name
    );
  ELSIF v_ret.product_condition = 'damaged' THEN
    UPDATE public.products
    SET damaged_quantity = ROUND(damaged_quantity + v_ret.base_quantity_returned, 4)
    WHERE id = v_ret.product_id
    RETURNING stock_quantity INTO v_new_balance;

    INSERT INTO public.stock_movements (
      product_id, transaction_ref, movement_type, description,
      stock_in, stock_out, running_balance,
      source_table, source_id, actor_type, actor_id, actor_name
    ) VALUES (
      v_ret.product_id, v_ret.refund_ref, 'damaged_stock',
      format('Returned damaged goods (%s) — not restored to saleable stock', v_ret.refund_ref),
      0, 0, v_new_balance,
      'return_requests', v_ret.id, 'owner', p_owner_id, v_owner.full_name
    );
  ELSE
    UPDATE public.products
    SET expired_quantity = ROUND(expired_quantity + v_ret.base_quantity_returned, 4)
    WHERE id = v_ret.product_id
    RETURNING stock_quantity INTO v_new_balance;

    INSERT INTO public.stock_movements (
      product_id, transaction_ref, movement_type, description,
      stock_in, stock_out, running_balance,
      source_table, source_id, actor_type, actor_id, actor_name
    ) VALUES (
      v_ret.product_id, v_ret.refund_ref, 'expired_stock',
      format('Returned expired goods (%s) — not restored to saleable stock', v_ret.refund_ref),
      0, 0, v_new_balance,
      'return_requests', v_ret.id, 'owner', p_owner_id, v_owner.full_name
    );
  END IF;

  -- Record cash drawer refund movement if refunded in cash against an open or associated shift
  IF p_refund_payment_method = 'cash' AND v_sale.shift_id IS NOT NULL THEN
    INSERT INTO public.cash_movements (
      shift_id, movement_type, amount, reference_id, description, created_by_type, created_by_id
    ) VALUES (
      v_sale.shift_id, 'cash_refund', v_ret.requested_refund_amount, v_ret.id,
      'Approved cash refund ' || v_ret.refund_ref, 'owner', p_owner_id
    );
  END IF;

  UPDATE public.sales
  SET payment_status = CASE WHEN v_ret.requested_refund_amount >= total_amount THEN 'refunded' ELSE 'partially_refunded' END
  WHERE id = v_ret.sale_id;

  UPDATE public.return_requests
  SET
    status = 'approved',
    reviewed_by_owner_id = p_owner_id,
    refund_payment_method = p_refund_payment_method,
    review_notes = p_review_notes,
    reviewed_at = NOW()
  WHERE id = p_return_id
  RETURNING * INTO v_ret;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'owner', p_owner_id, v_owner.full_name, 'REFUND_APPROVED', 'return_requests', v_ret.id,
    jsonb_build_object(
      'refund_ref', v_ret.refund_ref,
      'condition', v_ret.product_condition,
      'amount', v_ret.requested_refund_amount,
      'method', p_refund_payment_method
    )
  );

  RETURN v_ret;
END;
$$;

-- ============================================================================
-- 9. AUTHORIZED STOCK ADJUSTMENT / DAMAGED / EXPIRED / OPENING STOCK
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_record_stock_adjustment(
  p_product_id UUID,
  p_owner_id UUID,
  p_movement_type TEXT,
  p_quantity_delta NUMERIC,
  p_description TEXT
)
RETURNS public.stock_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.owner_profiles%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_new_balance NUMERIC(14,4);
  v_in NUMERIC(14,4) := 0;
  v_out NUMERIC(14,4) := 0;
  v_ref TEXT;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_owner FROM public.owner_profiles WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the authorized shop owner can adjust inventory';
  END IF;

  IF p_movement_type NOT IN ('opening_stock', 'damaged_stock', 'expired_stock', 'stock_adjustment', 'other') THEN
    RAISE EXCEPTION 'Invalid stock adjustment movement type';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_new_balance := ROUND(v_product.stock_quantity + p_quantity_delta, 4);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Stock adjustment would result in negative inventory';
  END IF;

  IF p_quantity_delta >= 0 THEN
    v_in := ROUND(p_quantity_delta, 4);
  ELSE
    v_out := ROUND(ABS(p_quantity_delta), 4);
  END IF;

  UPDATE public.products
  SET
    stock_quantity = v_new_balance,
    damaged_quantity = CASE WHEN p_movement_type = 'damaged_stock' AND p_quantity_delta < 0 THEN ROUND(damaged_quantity + ABS(p_quantity_delta), 4) ELSE damaged_quantity END,
    expired_quantity = CASE WHEN p_movement_type = 'expired_stock' AND p_quantity_delta < 0 THEN ROUND(expired_quantity + ABS(p_quantity_delta), 4) ELSE expired_quantity END
  WHERE id = p_product_id;

  v_ref := 'ADJ-' || TO_CHAR(NOW(), 'YYMMDD-HH24MISS') || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 4);

  INSERT INTO public.stock_movements (
    product_id, transaction_ref, movement_type, description,
    stock_in, stock_out, running_balance, unit_cost_basis,
    source_table, source_id, actor_type, actor_id, actor_name
  ) VALUES (
    p_product_id, v_ref, p_movement_type, p_description,
    v_in, v_out, v_new_balance, v_product.purchase_cost,
    'products', p_product_id, 'owner', p_owner_id, v_owner.full_name
  ) RETURNING * INTO v_movement;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, entity_id, details
  ) VALUES (
    'owner', p_owner_id, v_owner.full_name, 'STOCK_ADJUSTMENT', 'products', p_product_id,
    jsonb_build_object('movement_type', p_movement_type, 'delta', p_quantity_delta, 'new_balance', v_new_balance, 'reason', p_description)
  );

  RETURN v_movement;
END;
$$;
