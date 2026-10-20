create table if not exists public.platform_tenant_settings (
  tenant_id uuid primary key,
  host_id uuid not null,
  branding jsonb not null,
  locale jsonb not null,
  updated_at timestamptz not null,
  foreign key (tenant_id, host_id)
    references public.platform_tenants (id, host_id) on delete cascade
);

alter table public.platform_tenant_settings enable row level security;
revoke all on public.platform_tenant_settings from anon, authenticated;
grant all on public.platform_tenant_settings to service_role;

create or replace function public.update_platform_tenant_settings(
  p_tenant_id uuid,
  p_host_id uuid,
  p_branding jsonb,
  p_locale jsonb,
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
    tenant_id, host_id, branding, locale, updated_at
  ) values (
    p_tenant_id, p_host_id, p_branding, p_locale, p_updated_at
  )
  on conflict (tenant_id) do update
  set branding = excluded.branding,
      locale = excluded.locale,
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
  uuid, uuid, jsonb, jsonb, timestamptz, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_tenant_settings(
  uuid, uuid, jsonb, jsonb, timestamptz, text, uuid, text, text, timestamptz
) to service_role;
