create table if not exists public.platform_tenant_storage_providers (
  tenant_id uuid primary key,
  host_id uuid not null,
  config jsonb not null,
  updated_at timestamptz not null,
  foreign key (tenant_id, host_id)
    references public.platform_tenants (id, host_id) on delete cascade
);

alter table public.platform_tenant_storage_providers enable row level security;
revoke all on public.platform_tenant_storage_providers from anon, authenticated;
grant all on public.platform_tenant_storage_providers to service_role;

create or replace function public.update_platform_tenant_storage_provider(
  p_tenant_id uuid,
  p_host_id uuid,
  p_config jsonb,
  p_secret_ref uuid,
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
  if p_config->>'type' is distinct from 's3'
    or p_config->>'credentialsRef' is distinct from p_secret_ref::text then
    raise exception 'Tenant storage credential reference does not match provider config';
  end if;

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

  perform 1 from public.platform_secret_vault
    where ref = p_secret_ref and tenant_id = p_tenant_id::text;
  if not found then
    return false;
  end if;

  insert into public.platform_tenant_storage_providers (
    tenant_id, host_id, config, updated_at
  ) values (
    p_tenant_id, p_host_id, p_config, p_updated_at
  )
  on conflict (tenant_id) do update
  set config = excluded.config,
      updated_at = excluded.updated_at
  where public.platform_tenant_storage_providers.host_id = excluded.host_id;

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
    'tenant_storage_provider',
    p_audit_resource_id,
    p_audit_created_at
  );
  return true;
end;
$$;

revoke all on function public.update_platform_tenant_storage_provider(
  uuid, uuid, jsonb, uuid, timestamptz, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_tenant_storage_provider(
  uuid, uuid, jsonb, uuid, timestamptz, text, uuid, text, text, timestamptz
) to service_role;

create or replace function public.delete_platform_tenant_storage_provider(
  p_tenant_id uuid,
  p_host_id uuid,
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

  delete from public.platform_tenant_storage_providers
    where tenant_id = p_tenant_id and host_id = p_host_id;
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
    'tenant_storage_provider',
    p_audit_resource_id,
    p_audit_created_at
  );
  return true;
end;
$$;

revoke all on function public.delete_platform_tenant_storage_provider(
  uuid, uuid, timestamptz, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.delete_platform_tenant_storage_provider(
  uuid, uuid, timestamptz, text, uuid, text, text, timestamptz
) to service_role;
