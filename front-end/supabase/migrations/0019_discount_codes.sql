alter table public.platform_tenant_settings
  add column if not exists discounts jsonb not null default '[]'::jsonb
  check (jsonb_typeof(discounts) = 'array');

alter table public.platform_customer_orders
  add column if not exists discount_code text,
  add column if not exists discount_amount integer not null default 0;

alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_shipping_amounts_check,
  add constraint platform_customer_orders_discount_amounts_check
    check (
      discount_amount >= 0
      and discount_amount <= subtotal
      and total::bigint =
        subtotal::bigint - discount_amount::bigint + shipping_amount::bigint
    );

drop function if exists public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, jsonb, timestamptz, text, uuid, text, text,
  timestamptz
);

create function public.update_platform_tenant_settings(
  p_tenant_id uuid,
  p_host_id uuid,
  p_branding jsonb,
  p_locale jsonb,
  p_shipping jsonb,
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
    tenant_id, host_id, branding, locale, shipping, discounts, updated_at
  ) values (
    p_tenant_id, p_host_id, p_branding, p_locale, p_shipping, p_discounts,
    p_updated_at
  )
  on conflict (tenant_id) do update
  set branding = excluded.branding,
      locale = excluded.locale,
      shipping = excluded.shipping,
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
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text, uuid, text, text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text, uuid, text, text,
  timestamptz
) to service_role;

create table if not exists public.platform_discount_redemptions (
  tenant_id uuid not null references public.platform_tenants (id) on delete cascade,
  order_id text not null,
  code text not null check (code = upper(code)),
  status text not null check (status in ('reserved', 'released', 'committed')),
  updated_at timestamptz not null,
  primary key (tenant_id, order_id)
);

alter table public.platform_discount_redemptions enable row level security;
revoke all on public.platform_discount_redemptions from anon, authenticated;
grant all on public.platform_discount_redemptions to service_role;

create function public.reserve_platform_discount_redemption(
  p_tenant_id uuid,
  p_order_id text,
  p_code text,
  p_now timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_discounts jsonb;
  discount_config jsonb;
  redemption_limit integer;
  existing_code text;
  existing_status text;
  redemption_count integer;
begin
  select discounts into settings_discounts
    from public.platform_tenant_settings
    where tenant_id = p_tenant_id
    for update;
  if not found then
    return false;
  end if;

  select code, status into existing_code, existing_status
    from public.platform_discount_redemptions
    where tenant_id = p_tenant_id and order_id = p_order_id;
  if found and existing_status in ('reserved', 'committed') then
    return existing_code = upper(p_code);
  end if;

  select discount into discount_config
    from jsonb_array_elements(settings_discounts) as discount
    where upper(discount ->> 'code') = upper(p_code);
  if discount_config is null then
    return false;
  end if;
  if discount_config ? 'expiresAt'
    and (discount_config ->> 'expiresAt')::timestamptz <= p_now then
    return false;
  end if;

  if discount_config ? 'redemptionLimit' then
    redemption_limit := (discount_config ->> 'redemptionLimit')::integer;
    select count(*) into redemption_count
      from public.platform_discount_redemptions
      where tenant_id = p_tenant_id
        and code = upper(p_code)
        and status in ('reserved', 'committed');
    if redemption_count >= redemption_limit then
      return false;
    end if;
  end if;

  insert into public.platform_discount_redemptions (
    tenant_id, order_id, code, status, updated_at
  ) values (
    p_tenant_id, p_order_id, upper(p_code), 'reserved', p_now
  )
  on conflict (tenant_id, order_id) do update
    set code = excluded.code,
        status = 'reserved',
        updated_at = excluded.updated_at;
  return true;
end;
$$;

create function public.release_platform_discount_redemption(
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
      and status = 'reserved';
$$;

create function public.commit_platform_discount_redemption(
  p_tenant_id uuid,
  p_order_id text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.platform_discount_redemptions
    set status = 'committed', updated_at = now()
    where tenant_id = p_tenant_id
      and order_id = p_order_id
      and status = 'reserved';
$$;

revoke all on function public.reserve_platform_discount_redemption(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.release_platform_discount_redemption(uuid, text)
  from public, anon, authenticated;
revoke all on function public.commit_platform_discount_redemption(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_platform_discount_redemption(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.release_platform_discount_redemption(uuid, text)
  to service_role;
grant execute on function public.commit_platform_discount_redemption(uuid, text)
  to service_role;
