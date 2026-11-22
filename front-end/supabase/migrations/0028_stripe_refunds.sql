alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_payment_status_check;

alter table public.platform_customer_orders
  add constraint platform_customer_orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'cod_due', 'refunded'));
