# Provision Shop Management System — Database Schema & Relationships

## Entity Relationship Overview

1. **Identity & Access (`owner_profiles`, `cashiers`, `cashier_sessions`, `shop_settings`)**
   - `owner_profiles.id` references `auth.users(id)` (single shop Super Admin).
   - `cashiers` stores `access_code_hash` (`scrypt` + random 16-byte `code_salt`) and `code_fingerprint` (`HMAC-SHA256` unique constraint preventing duplicate active 6-digit codes without ever storing plaintext PINs).
   - `cashier_sessions` tracks active Bearer session hashes, expiration timestamps, and revocation.

2. **Products & Smart Unit Conversions (`categories`, `measurement_units`, `products`, `product_unit_conversions`, `product_barcodes`)**
   - Every product has a `base_unit_id` (e.g., `l`, `kg`, `pcs`) and stores `stock_quantity` as `NUMERIC(14,4)` in that base unit.
   - `product_unit_conversions` defines `conversion_to_base NUMERIC(14,6)` (e.g., `500 ml` -> `0.5` when base unit is `l`, or `Carton` -> `24` when base unit is `pcs`), supporting decimal deductions and custom sale/purchase prices.
   - `product_barcodes` allows scanning alternate pack barcodes directly into the matching unit conversion.

3. **Suppliers & Purchases (`suppliers`, `purchases`, `purchase_items`, `supplier_payments`)**
   - `purchases` enforces `status IN ('draft', 'ordered', 'received', 'cancelled')`.
   - Stock NEVER increases when a purchase is created as `draft` or `ordered`. Only `fn_receive_purchase` increments `products.stock_quantity`, updates `products.purchase_cost`, updates `suppliers.outstanding_balance`, and inserts `purchase_received` rows into `stock_movements`.
   - `supplier_payments` records partial/full supplier payments separately from stock movements.

4. **Cashier Shifts & Cash Movements (`cashier_shifts`, `cash_movements`)**
   - Partial unique index `idx_one_open_shift_per_cashier` guarantees at most one open shift per cashier.
   - `fn_close_cashier_shift` computes:
     `Expected Cash = Opening Cash + Cash Sales - Cash Drawer Expenses - Cash Refunds + Cash In - Cash Out`.
     MoMo sales and MoMo expenses are excluded from physical cash drawer math.

5. **Sales, Payments & Receipts (`sales`, `sale_items`, `payments`, `payment_webhook_events`, `receipts`)**
   - `sales.client_tx_ref` is `UNIQUE` for idempotency across online retries and offline cash synchronization.
   - `sale_items.cost_basis_per_base_unit` snapshots the historical `purchase_cost` at the moment of sale so historical profit reports never shift when later purchases change unit costs.
   - `payments` tracks Cash and Moolre Mobile Money independently (supporting split payments). Moolre callbacks are deduplicated via `payment_webhook_events.event_id`.
   - `receipts` snapshots receipt JSON at completion; owner reprints increment audit metadata without modifying stock or sales.

6. **Expenses & Single-Use QR Evidence (`expense_categories`, `expense_qr_sessions`, `expenses`)**
   - `expense_qr_sessions` stores `token_hash` with a 15-minute expiry and single-use `status` (`active -> used`).
   - `fn_submit_qr_expense` validates the QR session atomically, saves `evidence_path` from the private `expense-evidence` Storage bucket, and deducts drawer cash only if `payment_source = 'cash_drawer'`.

7. **Storebook, Returns & Audit (`stock_movements`, `return_requests`, `sms_configurations`, `sms_logs`, `audit_logs`)**
   - `stock_movements` is an append-only ledger written exclusively by authorized PostgreSQL functions.
   - `return_requests` requires owner review (`fn_review_return_request`); stock is restored ONLY when `product_condition = 'resaleable'`.

## Row Level Security (RLS) & Private Storage
- RLS is enabled on all 28 tables in `003_rls_and_storage.sql`.
- Direct client access is restricted to the authenticated shop owner (`is_shop_owner()`).
- Cashiers authenticate through server-verified Bearer sessions in `server.ts`, which executes validated mutations via `SECURITY DEFINER` RPCs.
- Storage buckets `expense-evidence` and `product-images` are private (`public = FALSE`), accessed via short-lived signed URLs for the authenticated owner.
