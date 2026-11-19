create or replace function public.delete_platform_host(
  p_host_id uuid,
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
  if exists (
    select 1
    from public.platform_tenants
    where host_id = p_host_id
  ) then
    raise exception 'host has tenants';
  end if;

  delete from public.platform_hosts
  where id = p_host_id;

  if not found then
    return false;
  end if;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_actor_id,
    '{"kind":"platform","id":"platform"}'::jsonb,
    p_audit_action,
    p_audit_resource_type,
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

revoke all on function public.delete_platform_host(
  uuid, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.delete_platform_host(
  uuid, text, uuid, text, text, text, timestamptz
) to service_role;
