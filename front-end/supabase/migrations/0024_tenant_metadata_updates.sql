create or replace function public.update_platform_tenant(
  p_host_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_plan text,
  p_updated_at timestamptz,
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
  update public.platform_tenants
  set name = p_name,
      plan = p_plan,
      updated_at = p_updated_at
  where id = p_tenant_id and host_id = p_host_id;

  if not found then
    return false;
  end if;

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

revoke all on function public.update_platform_tenant(
  uuid, uuid, text, text, timestamptz, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_tenant(
  uuid, uuid, text, text, timestamptz, text, uuid, text, text, text, timestamptz
) to service_role;
