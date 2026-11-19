alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_status_check,
  add constraint platform_customer_orders_status_check
    check (status in ('Confirmed', 'Processing', 'Shipped', 'Cancelled'));

create function public.cancel_platform_discount_redemption(
  p_tenant_id uuid,
  p_order_id text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.platform_discount_redemptions
    set status = 'released', updated_at = now()
    where tenant_id = p_tenant_id
      and order_id = p_order_id
      and status in ('reserved', 'committed');
$$;

revoke all on function public.cancel_platform_discount_redemption(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_platform_discount_redemption(uuid, text)
  to service_role;

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
      and payment_status = 'cod_due'
      and status <> 'Cancelled';
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
