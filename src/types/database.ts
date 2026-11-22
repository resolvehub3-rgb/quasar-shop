export type UserRole = 'owner' | 'cashier';

export interface ShopSettings {
  id: string;
  owner_user_id: string;
  shop_name: string;
  tagline: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  thermal_paper_width: '58mm' | '80mm';
  max_cashier_discount_pct: number;
  allow_credit_sales: boolean;
  refund_payment_policy: 'unconfigured' | 'cash_only' | 'match_original_or_cash' | 'owner_selected';
  moolre_enabled: boolean;
  moolre_supported_networks: string[];
}

export interface MeasurementUnit {
  id: string;
  code: string;
  name: string;
  unit_type: 'count' | 'weight' | 'volume' | 'pack';
  allow_decimal: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface ProductUnitConversion {
  id: string;
  product_id: string;
  unit_name: string;
  unit_code: string;
  conversion_to_base: number;
  selling_price: number | null;
  is_purchase_unit: boolean;
  is_sale_unit: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  description: string | null;
  purchase_cost: number | null;
  selling_price: number;
  base_unit_id: string;
  stock_quantity: number;
  min_stock_level: number;
  damaged_quantity?: number;
  expired_quantity?: number;
  image_path: string | null;
  expiry_date: string | null;
  is_archived: boolean;
  measurement_units?: MeasurementUnit;
  categories?: { name: string } | null;
  product_unit_conversions?: ProductUnitConversion[];
  product_barcodes?: { barcode: string; unit_conversion_id: string | null }[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  outstanding_balance: number;
  is_active: boolean;
  created_at: string;
}

export interface Cashier {
  id: string;
  full_name: string;
  phone: string;
  status: 'active' | 'suspended' | 'revoked';
  failed_attempts: number;
  last_login_at: string | null;
  created_at: string;
}

export interface CashierShift {
  id: string;
  shift_ref: string;
  cashier_id: string;
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  expected_cash: number | null;
  declared_cash: number | null;
  cash_discrepancy: number | null;
  status: 'open' | 'closed';
  closing_notes: string | null;
  cashiers?: { full_name: string; phone: string };
}

export interface SaleRecord {
  id: string;
  receipt_number: string;
  client_tx_ref: string;
  shift_id: string | null;
  cashier_id: string | null;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  change_given: number;
  payment_status: 'pending' | 'partial' | 'paid' | 'refunded' | 'partially_refunded' | 'cancelled';
  sync_source: 'online' | 'offline_sync';
  completed_at: string | null;
  created_at: string;
  cashiers?: { full_name: string } | null;
  payments?: Array<{
    id?: string;
    payment_reference?: string;
    method: 'cash' | 'momo';
    network?: string | null;
    amount: number;
    status: string;
  }>;
  sale_items?: Array<{
    id: string;
    product_id: string;
    product_name: string;
    sale_unit_name: string;
    quantity_in_sale_unit: number;
    conversion_to_base: number;
    base_quantity_deducted: number;
    unit_price: number;
    cost_basis_per_base_unit?: number | null;
    line_total: number;
  }>;
}

export interface ReceiptSnapshot {
  receipt_number: string;
  client_tx_ref: string;
  date: string;
  cashier_name: string;
  items: Array<{
    product_name: string;
    unit_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{
    method: 'cash' | 'momo';
    network?: string;
    amount: number;
    tendered?: number;
    change?: number;
    reference?: string;
  }>;
  change_given: number;
}

export interface ExpenseRecord {
  id: string;
  expense_ref: string;
  shift_id: string | null;
  cashier_id: string | null;
  expense_name: string;
  category_name: string;
  amount: number;
  payment_source: 'cash_drawer' | 'momo' | 'other';
  description: string | null;
  evidence_path: string | null;
  status: 'recorded' | 'voided';
  created_at: string;
  cashiers?: { full_name: string } | null;
  cashier_shifts?: { shift_ref: string } | null;
}

export interface StockMovementRecord {
  id: string;
  product_id: string;
  transaction_ref: string;
  movement_type: string;
  description: string;
  stock_in: number;
  stock_out: number;
  running_balance: number;
  unit_cost_basis: number | null;
  actor_type: string;
  actor_name: string;
  created_at: string;
  products?: { name: string; measurement_units?: { code: string } };
}

export interface ReturnRequestRecord {
  id: string;
  refund_ref: string;
  sale_id: string;
  sale_item_id: string;
  product_id: string;
  quantity_returned: number;
  base_quantity_returned: number;
  reason: string;
  product_condition: 'resaleable' | 'damaged' | 'expired';
  requested_refund_amount: number;
  status: 'pending' | 'approved' | 'rejected';
  refund_payment_method: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  sales?: { receipt_number: string };
  products?: { name: string };
  cashiers?: { full_name: string } | null;
}

export interface SmsConfig {
  id: string;
  owner_phone: string;
  sender_id: string;
  notify_shift_open: boolean;
  notify_shift_close: boolean;
  notify_expense: boolean;
  scheduled_enabled: boolean;
  scheduled_frequency_days: 5 | 7;
  scheduled_destination_phone: string;
  scheduled_sections: Record<string, boolean>;
  last_scheduled_sent_at: string | null;
}
