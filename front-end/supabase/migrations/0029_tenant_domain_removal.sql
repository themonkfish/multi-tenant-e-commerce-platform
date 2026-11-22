create or replace function public.remove_platform_tenant_domain(
  p_host_id uuid,
  p_tenant_id uuid,
  p_domain text,
  p_updated_at timestamptz,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(87359911);
  if not exists (
    select 1
    from public.platform_tenant_domains
    where domain = p_domain
      and tenant_id = p_tenant_id
      and host_id = p_host_id
  ) then
    return false;
  end if;

  delete from public.platform_tenant_domains
  where domain = p_domain
    and tenant_id = p_tenant_id
    and host_id = p_host_id;

  update public.platform_tenants
  set updated_at = p_updated_at
  where id = p_tenant_id and host_id = p_host_id;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id, p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    'tenant.domain_removed', 'tenant_domain', p_domain, p_audit_created_at
  );
  return true;
end;
$$;

revoke all on function public.remove_platform_tenant_domain(
  uuid, uuid, text, timestamptz, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.remove_platform_tenant_domain(
  uuid, uuid, text, timestamptz, text, uuid, timestamptz
) to service_role;
