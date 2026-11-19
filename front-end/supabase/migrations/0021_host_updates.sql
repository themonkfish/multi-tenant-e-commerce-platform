create or replace function public.update_platform_host(
  p_host_id uuid,
  p_slug text,
  p_name text,
  p_plan text,
  p_max_tenants integer,
  p_max_custom_domains integer,
  p_domains text[],
  p_support_contact text,
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
declare
  existing_branding jsonb;
begin
  select branding into existing_branding
  from public.platform_hosts
  where id = p_host_id;
  if not found then
    return false;
  end if;

  begin
    update public.platform_hosts
    set
      slug = p_slug,
      name = p_name,
      plan = p_plan,
      limits = jsonb_build_object(
        'maxTenants', p_max_tenants,
        'maxCustomDomains', p_max_custom_domains,
        'features', coalesce(
          (limits -> 'features'),
          '{}'::jsonb
        )
      ),
      branding = jsonb_set(
        coalesce(existing_branding, '{}'::jsonb),
        '{name}',
        to_jsonb(p_name),
        true
      ),
      support_contact = p_support_contact,
      updated_at = p_updated_at
    where id = p_host_id;

    delete from public.platform_host_domains
    where host_id = p_host_id;

    insert into public.platform_host_domains (domain, host_id, created_at)
    select domain, p_host_id, p_updated_at
    from unnest(p_domains) as requested_domains(domain);
  exception when unique_violation then
    return false;
  end;

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

revoke all on function public.update_platform_host(
  uuid, text, text, text, integer, integer, text[], text, timestamptz,
  text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_platform_host(
  uuid, text, text, text, integer, integer, text[], text, timestamptz,
  text, uuid, text, text, text, timestamptz
) to service_role;
