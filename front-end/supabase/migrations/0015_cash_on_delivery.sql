alter table public.platform_customer_orders
  add column if not exists payment_method text not null default 'stripe',
  add column if not exists delivery_address jsonb;

alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_payment_status_check,
  drop constraint if exists platform_customer_orders_payment_method_check,
  drop constraint if exists platform_customer_orders_cod_details_check;

alter table public.platform_customer_orders
  add constraint platform_customer_orders_payment_status_check
    check (payment_status in ('pending', 'paid', 'failed', 'cod_due')),
  add constraint platform_customer_orders_payment_method_check
    check (payment_method in ('stripe', 'cash_on_delivery')),
  add constraint platform_customer_orders_cod_details_check
    check (
      (
        payment_method = 'stripe'
        and payment_status <> 'cod_due'
      )
      or (
        payment_method = 'cash_on_delivery'
        and currency = 'INR'
        and payment_status in ('cod_due', 'paid')
        and payment_attempt = 0
        and payment_session_id is null
        and payment_intent_id is null
        and delivery_address is not null
        and jsonb_typeof(delivery_address) = 'object'
        and delivery_address->>'country' is not null
        and delivery_address->>'country' = 'IN'
        and nullif(btrim(delivery_address->>'fullName'), '') is not null
        and nullif(btrim(delivery_address->>'line1'), '') is not null
        and nullif(btrim(delivery_address->>'city'), '') is not null
        and nullif(btrim(delivery_address->>'state'), '') is not null
        and delivery_address->>'postalCode' is not null
        and delivery_address->>'postalCode' ~ '^[0-9]{6}$'
        and delivery_address->>'phone' is not null
        and delivery_address->>'phone' ~ '^\+91[6-9][0-9]{9}$'
      )
    );

create index if not exists platform_customer_orders_cod_due_idx
  on public.platform_customer_orders (tenant_id, created_at desc)
  where payment_method = 'cash_on_delivery' and payment_status = 'cod_due';

create or replace function public.mark_platform_customer_order_cod_collected(
  p_tenant_id uuid,
  p_order_id text,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_action text,
  p_audit_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant_host_id uuid;
begin
  select tenant.host_id
    into tenant_host_id
    from public.platform_tenants tenant
    join public.platform_hosts host on host.id = tenant.host_id
    where tenant.id = p_tenant_id
      and tenant.status = 'active'
      and host.status = 'active'
    for update of tenant, host;
  if not found then
    return false;
  end if;

  update public.platform_customer_orders
    set payment_status = 'paid'
    where tenant_id = p_tenant_id
      and id = p_order_id
      and payment_method = 'cash_on_delivery'
      and payment_status = 'cod_due';
  if not found then
    return false;
  end if;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_actor_id,
    jsonb_build_object(
      'kind', 'tenant',
      'id', p_tenant_id::text,
      'hostId', tenant_host_id::text
    ),
    p_audit_action,
    'customer_order_payment',
    p_order_id,
    p_audit_created_at
  );
  return true;
end;
$$;

revoke all on function public.mark_platform_customer_order_cod_collected(
  uuid, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.mark_platform_customer_order_cod_collected(
  uuid, text, text, uuid, text, timestamptz
) to service_role;
