-- Backfill historical cost basis for sales created before product purchase costs were set.
-- Run this AFTER setting purchase_cost on products (Products page or products table).
-- It only fills NULL cost_basis_per_base_unit values, so historical snapshots are preserved.

UPDATE public.sale_items si
SET cost_basis_per_base_unit = p.purchase_cost
FROM public.products p
WHERE si.product_id = p.id
  AND si.cost_basis_per_base_unit IS NULL
  AND p.purchase_cost IS NOT NULL;

-- Keep stock movement cost basis in sync for historical rows that were recorded as NULL.
UPDATE public.stock_movements sm
SET unit_cost_basis = p.purchase_cost
FROM public.products p
WHERE sm.product_id = p.id
  AND sm.unit_cost_basis IS NULL
  AND p.purchase_cost IS NOT NULL;

-- Helpful view: products still missing a purchase cost (fix these to enable profit tracking).
-- (Run manually to see which products need attention.)
-- SELECT id, name, purchase_cost FROM public.products WHERE is_archived = false AND purchase_cost IS NULL ORDER BY name;
