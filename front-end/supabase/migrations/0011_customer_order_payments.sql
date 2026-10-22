alter table public.platform_customer_orders
  add column if not exists payment_status text not null default 'paid'
    check (payment_status in ('pending', 'paid', 'failed')),
  add column if not exists payment_attempt integer not null default 0
    check (payment_attempt >= 0),
  add column if not exists payment_session_id text,
  add column if not exists payment_intent_id text;

create index if not exists platform_customer_orders_payment_session_idx
  on public.platform_customer_orders (payment_session_id)
  where payment_session_id is not null;
