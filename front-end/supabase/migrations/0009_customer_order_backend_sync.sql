alter table public.platform_customer_orders
  add column if not exists backend_sync_status text not null default 'not_configured'
    check (backend_sync_status in ('not_configured', 'pending', 'synced', 'failed')),
  add column if not exists backend_sync_error text;
