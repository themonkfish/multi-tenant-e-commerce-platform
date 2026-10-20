create table if not exists public.platform_host_owners (
  id uuid primary key,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  email text not null check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null
);

create unique index if not exists platform_host_owners_email_idx
  on public.platform_host_owners (email);

create table if not exists public.platform_host_owner_invites (
  id uuid primary key,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  unique (host_id, email)
);

create table if not exists public.platform_tenants (
  id uuid primary key,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  name text not null,
  status text not null check (status in ('pending', 'active', 'suspended')),
  plan text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (host_id, slug)
);

create index if not exists platform_tenants_host_id_idx
  on public.platform_tenants (host_id);

create table if not exists public.platform_tenant_domains (
  domain text primary key check (domain = lower(domain)),
  tenant_id uuid not null references public.platform_tenants (id) on delete cascade,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  created_at timestamptz not null
);

alter table public.platform_host_owners enable row level security;
alter table public.platform_host_owner_invites enable row level security;
alter table public.platform_tenants enable row level security;
alter table public.platform_tenant_domains enable row level security;

revoke all on public.platform_host_owners, public.platform_host_owner_invites,
  public.platform_tenants, public.platform_tenant_domains
  from anon, authenticated;
grant all on public.platform_host_owners, public.platform_host_owner_invites,
  public.platform_tenants, public.platform_tenant_domains to service_role;

create or replace function public.enforce_platform_domain_uniqueness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(87359911);

  if tg_table_name = 'platform_host_domains' then
    if exists (
      select 1 from public.platform_tenant_domains
      where domain = new.domain
    ) then
      raise exception using
        errcode = '23505',
        message = 'domain is already assigned to a tenant';
    end if;
  elsif exists (
    select 1 from public.platform_host_domains
    where domain = new.domain
  ) then
    raise exception using
      errcode = '23505',
      message = 'domain is already assigned to a host';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_host_domains_check_tenant_domains
  on public.platform_host_domains;
create trigger platform_host_domains_check_tenant_domains
  before insert or update on public.platform_host_domains
  for each row execute function public.enforce_platform_domain_uniqueness();

drop trigger if exists platform_tenant_domains_check_host_domains
  on public.platform_tenant_domains;
create trigger platform_tenant_domains_check_host_domains
  before insert or update on public.platform_tenant_domains
  for each row execute function public.enforce_platform_domain_uniqueness();

create or replace function public.create_platform_host_owner_invite(
  p_invite_id uuid,
  p_host_id uuid,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_at timestamptz,
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
  perform pg_advisory_xact_lock(
    hashtextextended(p_host_id::text || ':' || lower(p_email), 0)
  );

  if not exists (
    select 1 from public.platform_hosts
    where id = p_host_id and status = 'active'
  ) or exists (
    select 1 from public.platform_host_owners
    where email = lower(p_email)
  ) then
    return false;
  end if;

  delete from public.platform_host_owner_invites
  where host_id = p_host_id and email = lower(p_email);

  insert into public.platform_host_owner_invites (
    id, host_id, email, token_hash, expires_at, created_at
  ) values (
    p_invite_id, p_host_id, lower(p_email), p_token_hash, p_expires_at,
    p_created_at
  );

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    p_audit_action,
    'host_owner_invite',
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

create or replace function public.accept_platform_host_owner_invite(
  p_token_hash text,
  p_owner_id uuid,
  p_password_hash text,
  p_now timestamptz,
  p_audit_id uuid,
  p_audit_actor_id text,
  p_audit_action text,
  p_audit_created_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.platform_host_owner_invites%rowtype;
  owner_row public.platform_host_owners%rowtype;
begin
  select * into invite_row
  from public.platform_host_owner_invites
  where token_hash = p_token_hash and expires_at > p_now
  for update;

  if not found or not exists (
    select 1 from public.platform_hosts
    where id = invite_row.host_id and status = 'active'
  ) or exists (
    select 1 from public.platform_host_owners
    where email = invite_row.email
  ) then
    return null;
  end if;

  insert into public.platform_host_owners (
    id, host_id, email, password_hash, created_at
  ) values (
    p_owner_id, invite_row.host_id, invite_row.email, p_password_hash, p_now
  ) returning * into owner_row;

  delete from public.platform_host_owner_invites
  where id = invite_row.id;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_audit_actor_id,
    jsonb_build_object('kind', 'host', 'id', invite_row.host_id::text),
    p_audit_action,
    'host_owner',
    owner_row.id::text,
    p_audit_created_at
  );

  return jsonb_build_object(
    'id', owner_row.id,
    'hostId', owner_row.host_id,
    'email', owner_row.email,
    'passwordHash', owner_row.password_hash,
    'createdAt', owner_row.created_at
  );
exception when unique_violation then
  return null;
end;
$$;

create or replace function public.create_platform_tenant(
  p_tenant_id uuid,
  p_host_id uuid,
  p_slug text,
  p_name text,
  p_status text,
  p_plan text,
  p_domains text[],
  p_created_at timestamptz,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_action text,
  p_audit_resource_id text,
  p_audit_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_row public.platform_hosts%rowtype;
  tenant_count integer;
  assigned_domain_count integer;
  max_tenants integer;
  max_domains integer;
begin
  perform pg_advisory_xact_lock(87359911);
  select * into host_row from public.platform_hosts
  where id = p_host_id and status = 'active' for update;
  if not found then
    return 'host_unavailable';
  end if;

  select count(*) into tenant_count
  from public.platform_tenants where host_id = p_host_id;
  max_tenants := (host_row.limits ->> 'maxTenants')::integer;
  if tenant_count >= max_tenants then
    return 'tenant_limit_reached';
  end if;

  select count(*)::integer
    into assigned_domain_count
  from public.platform_host_domains where host_id = p_host_id;
  assigned_domain_count := assigned_domain_count + (
    select count(*) from public.platform_tenant_domains
    where host_id = p_host_id
  );
  max_domains := (host_row.limits ->> 'maxCustomDomains')::integer;
  if assigned_domain_count + cardinality(p_domains) > max_domains then
    return 'custom_domain_limit_reached';
  end if;

  if exists (
    select 1 from unnest(p_domains) requested(domain)
    where exists (
      select 1 from public.platform_host_domains existing
      where existing.domain = requested.domain
    ) or exists (
      select 1 from public.platform_tenant_domains existing
      where existing.domain = requested.domain
    )
  ) then
    return 'tenant_slug_or_domain_in_use';
  end if;

  if exists (
    select 1
    from unnest(p_domains) requested(domain)
    join public.platform_state state on state.id = 1
    where requested.domain = lower(state.platform_domain)
      or exists (
        select 1
        from unnest(state.reserved_subdomains) reserved(slug)
        where requested.domain =
          lower(reserved.slug) || '.' || lower(state.platform_domain)
      )
  ) then
    return 'tenant_slug_or_domain_in_use';
  end if;

  insert into public.platform_tenants (
    id, host_id, slug, name, status, plan, created_at, updated_at
  ) values (
    p_tenant_id, p_host_id, p_slug, p_name, p_status, p_plan, p_created_at,
    p_created_at
  );

  insert into public.platform_tenant_domains (
    domain, tenant_id, host_id, created_at
  )
  select requested.domain, p_tenant_id, p_host_id, p_created_at
  from unnest(p_domains) as requested(domain);

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    p_audit_action,
    'tenant',
    p_audit_resource_id,
    p_audit_created_at
  );

  return 'created';
exception when unique_violation then
  return 'tenant_slug_or_domain_in_use';
end;
$$;

create or replace function public.update_platform_tenant_status(
  p_host_id uuid,
  p_tenant_id uuid,
  p_status text,
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
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'invalid tenant status';
  end if;

  if p_status = 'active' then
    perform 1 from public.platform_hosts
    where id = p_host_id and status = 'active'
    for update;
    if not found then
      return false;
    end if;
  end if;

  update public.platform_tenants
  set status = p_status, updated_at = p_updated_at
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
    'tenant',
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

revoke all on function public.create_platform_host_owner_invite(
  uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text, text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.accept_platform_host_owner_invite(
  text, uuid, text, timestamptz, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.create_platform_tenant(
  uuid, uuid, text, text, text, text, text[], timestamptz, text, uuid, text,
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.update_platform_tenant_status(
  uuid, uuid, text, timestamptz, text, uuid, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_platform_host_owner_invite(
  uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text, text,
  timestamptz
) to service_role;
grant execute on function public.accept_platform_host_owner_invite(
  text, uuid, text, timestamptz, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.create_platform_tenant(
  uuid, uuid, text, text, text, text, text[], timestamptz, text, uuid, text,
  text, timestamptz
) to service_role;
grant execute on function public.update_platform_tenant_status(
  uuid, uuid, text, timestamptz, text, uuid, text, text, timestamptz
) to service_role;
