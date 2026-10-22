alter table public.platform_customer_orders
  add column if not exists items jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_customer_orders_items_array_check'
      and conrelid = 'public.platform_customer_orders'::regclass
  ) then
    alter table public.platform_customer_orders
      add constraint platform_customer_orders_items_array_check
      check (jsonb_typeof(items) = 'array');
  end if;
end
$$;
