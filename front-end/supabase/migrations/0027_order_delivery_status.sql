alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_status_check,
  add constraint platform_customer_orders_status_check
    check (
      status in (
        'Confirmed',
        'Processing',
        'Shipped',
        'Delivered',
        'Cancelled'
      )
    );
