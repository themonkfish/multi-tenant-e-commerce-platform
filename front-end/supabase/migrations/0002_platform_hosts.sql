create table if not exists public.platform_hosts (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  name text not null,
  status text not null check (status in ('pending', 'active', 'suspended')),
  plan text not null,
  limits jsonb not null,
  branding jsonb not null,
  support_contact text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.platform_host_domains (
  domain text primary key,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  created_at timestamptz not null,
  check (domain = lower(domain))
);

alter table public.platform_hosts enable row level security;
alter table public.platform_host_domains enable row level security;

revoke all on public.platform_hosts, public.platform_host_domains
  from anon, authenticated;
grant all on public.platform_hosts, public.platform_host_domains to service_role;

create or replace function public.create_platform_host(
  p_host_id uuid,
  p_slug text,
  p_name text,
  p_status text,
  p_plan text,
  p_limits jsonb,
  p_branding jsonb,
  p_domains text[],
  p_support_contact text,
  p_created_at timestamptz,
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
  begin
    insert into public.platform_hosts (
      id, slug, name, status, plan, limits, branding, support_contact,
      created_at, updated_at
    ) values (
      p_host_id, p_slug, p_name, p_status, p_plan, p_limits, p_branding,
      p_support_contact, p_created_at, p_created_at
    );

    insert into public.platform_host_domains (domain, host_id, created_at)
    select domain, p_host_id, p_created_at
    from unnest(p_domains) as requested_domains(domain);

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
  exception when unique_violation then
    return false;
  end;

  return true;
end;
$$;

create or replace function public.update_platform_host_status(
  p_host_id uuid,
  p_status text,
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
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'invalid host status';
  end if;

  update public.platform_hosts
  set status = p_status, updated_at = p_updated_at
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

revoke all on function public.create_platform_host(
  uuid, text, text, text, text, jsonb, jsonb, text[], text, timestamptz,
  text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.update_platform_host_status(
  uuid, text, timestamptz, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_platform_host(
  uuid, text, text, text, text, jsonb, jsonb, text[], text, timestamptz,
  text, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.update_platform_host_status(
  uuid, text, timestamptz, text, uuid, text, text, text, timestamptz
) to service_role;
