alter table public.platform_customer_orders
  add column if not exists refunded_amount integer not null default 0
  constraint platform_customer_orders_refunded_amount_check
    check (refunded_amount >= 0 and refunded_amount <= total),
  add column if not exists refund_ids jsonb not null default '[]'::jsonb
  constraint platform_customer_orders_refund_ids_check
    check (jsonb_typeof(refund_ids) = 'array');
