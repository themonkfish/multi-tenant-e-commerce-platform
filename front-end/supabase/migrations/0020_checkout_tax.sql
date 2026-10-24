alter table public.platform_tenant_settings
  add column if not exists tax jsonb not null default '{"rateBasisPoints":0}'::jsonb
  check (jsonb_typeof(tax) = 'object');

alter table public.platform_customer_orders
  add column if not exists tax_rate_basis_points integer not null default 0,
  add column if not exists tax_amount integer not null default 0;

alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_discount_amounts_check,
  add constraint platform_customer_orders_tax_amounts_check
    check (
      discount_amount >= 0
      and discount_amount <= subtotal
      and tax_rate_basis_points between 0 and 10000
      and tax_amount >= 0
      and tax_amount::bigint = round(
        (
          (subtotal::bigint - discount_amount::bigint)
          * tax_rate_basis_points::bigint
        )::numeric / 10000
      )
      and total::bigint =
        subtotal::bigint - discount_amount::bigint
        + tax_amount::bigint + shipping_amount::bigint
    );

drop function if exists public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text, uuid, text, text,
  timestamptz
);

create function public.update_platform_tenant_settings(
  p_tenant_id uuid,
  p_host_id uuid,
  p_branding jsonb,
  p_locale jsonb,
  p_shipping jsonb,
  p_tax jsonb,
  p_discounts jsonb,
  p_updated_at timestamptz,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_action text,
  p_audit_resource_id text,
  p_audit_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.platform_tenants tenant
    join public.platform_hosts host on host.id = tenant.host_id
    where tenant.id = p_tenant_id
      and tenant.host_id = p_host_id
      and tenant.status = 'active'
      and host.status = 'active'
    for update of tenant, host;
  if not found then
    return false;
  end if;

  insert into public.platform_tenant_settings (
    tenant_id, host_id, branding, locale, shipping, tax, discounts, updated_at
  ) values (
    p_tenant_id, p_host_id, p_branding, p_locale, p_shipping, p_tax,
    p_discounts, p_updated_at
  )
  on conflict (tenant_id) do update
  set branding = excluded.branding,
      locale = excluded.locale,
      shipping = excluded.shipping,
      tax = excluded.tax,
      discounts = excluded.discounts,
      updated_at = excluded.updated_at
  where public.platform_tenant_settings.host_id = excluded.host_id;

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
      'hostId', p_host_id::text
    ),
    p_audit_action,
    'tenant_settings',
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

revoke all on function public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, text, uuid,
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, text, uuid,
  text, text, timestamptz
) to service_role;
