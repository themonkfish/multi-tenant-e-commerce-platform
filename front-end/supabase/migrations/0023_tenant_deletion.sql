create or replace function public.delete_platform_tenant(
  p_host_id uuid,
  p_tenant_id uuid,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_action text,
  p_audit_resource_type text,
  p_audit_resource_id text,
  p_audit_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_tenants
    where id = p_tenant_id and host_id = p_host_id
  ) then
    return false;
  end;

  delete from public.platform_secret_vault
  where tenant_id = p_tenant_id;
  delete from public.platform_discount_redemptions
  where tenant_id = p_tenant_id;
  delete from public.platform_customer_orders
  where tenant_id = p_tenant_id;
  delete from public.platform_customers
  where tenant_id = p_tenant_id;
  delete from public.platform_tenant_staff
  where tenant_id = p_tenant_id;
  delete from public.platform_tenant_owner_invites
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_owners
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_settings
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_rest_connections
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_database_providers
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_storage_providers
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_domain_claims
  where tenant_id = p_tenant_id and host_id = p_host_id;
  delete from public.platform_tenant_domains
  where tenant_id = p_tenant_id and host_id = p_host_id;

  delete from public.platform_tenants
  where id = p_tenant_id and host_id = p_host_id;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    p_audit_action,
    p_audit_resource_type,
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

revoke all on function public.delete_platform_tenant(
  uuid, uuid, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.delete_platform_tenant(
  uuid, uuid, text, uuid, text, text, text, timestamptz
) to service_role;
