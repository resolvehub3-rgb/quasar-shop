-- Add local provision-shop measurement units (idempotent).
INSERT INTO public.measurement_units (code, name, unit_type, allow_decimal)
VALUES
  ('cup', 'Cup', 'count', TRUE),
  ('lonca', 'Lonca (Large Tomato Tin)', 'pack', FALSE)
ON CONFLICT (code) DO NOTHING;
