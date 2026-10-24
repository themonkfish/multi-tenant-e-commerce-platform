create table if not exists public.platform_tenant_domain_claims (
  domain text primary key check (domain = lower(domain)),
  tenant_id uuid not null references public.platform_tenants (id) on delete cascade,
  host_id uuid not null references public.platform_hosts (id) on delete cascade,
  verification_token text not null check (length(verification_token) = 64),
  created_at timestamptz not null
);

alter table public.platform_tenant_domain_claims enable row level security;
revoke all on public.platform_tenant_domain_claims from anon, authenticated;
grant all on public.platform_tenant_domain_claims to service_role;

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
    ) or exists (
      select 1 from public.platform_tenant_domain_claims
      where domain = new.domain
    ) then
      raise exception using
        errcode = '23505',
        message = 'domain is already assigned to a tenant';
    end if;
  elsif exists (
    select 1 from public.platform_host_domains
    where domain = new.domain
  ) or exists (
    select 1 from public.platform_tenant_domain_claims
    where domain = new.domain and tenant_id <> new.tenant_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'domain is already assigned to a host or tenant';
  end if;

  return new;
end;
$$;

create or replace function public.create_platform_tenant_domain_claim(
  p_host_id uuid,
  p_tenant_id uuid,
  p_domain text,
  p_verification_token text,
  p_created_at timestamptz,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_row public.platform_hosts%rowtype;
  assigned_domain_count integer;
  max_domains integer;
begin
  perform pg_advisory_xact_lock(87359911);
  select * into host_row from public.platform_hosts
  where id = p_host_id and status = 'active' for update;
  if not found or not exists (
    select 1 from public.platform_tenants
    where id = p_tenant_id and host_id = p_host_id
  ) then
    return 'tenant_unavailable';
  end if;

  if exists (
    select 1 from public.platform_host_domains where domain = p_domain
    union all
    select 1 from public.platform_tenant_domains where domain = p_domain
    union all
    select 1 from public.platform_tenant_domain_claims where domain = p_domain
  ) then
    return 'tenant_slug_or_domain_in_use';
  end if;

  if exists (
    select 1
    from public.platform_state state
    where state.id = 1 and (
      p_domain = lower(state.platform_domain)
      or exists (
        select 1
        from unnest(state.reserved_subdomains) reserved(slug)
        where p_domain = lower(reserved.slug) || '.' || lower(state.platform_domain)
      )
    )
  ) then
    return 'tenant_slug_or_domain_in_use';
  end if;

  select count(*) into assigned_domain_count
  from public.platform_host_domains where host_id = p_host_id;
  assigned_domain_count := assigned_domain_count + (
    select count(*) from public.platform_tenant_domains
    where host_id = p_host_id
  ) + (
    select count(*) from public.platform_tenant_domain_claims
    where host_id = p_host_id
  );
  max_domains := (host_row.limits ->> 'maxCustomDomains')::integer;
  if assigned_domain_count >= max_domains then
    return 'custom_domain_limit_reached';
  end if;

  insert into public.platform_tenant_domain_claims (
    domain, tenant_id, host_id, verification_token, created_at
  ) values (
    p_domain, p_tenant_id, p_host_id, p_verification_token, p_created_at
  );
  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id, p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    'tenant.domain_verification_started', 'tenant_domain', p_domain,
    p_audit_created_at
  );
  return 'created';
exception when unique_violation then
  return 'tenant_slug_or_domain_in_use';
end;
$$;

create or replace function public.complete_platform_tenant_domain_claim(
  p_host_id uuid,
  p_tenant_id uuid,
  p_domain text,
  p_verification_token text,
  p_updated_at timestamptz,
  p_actor_id text,
  p_audit_id uuid,
  p_audit_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(87359911);
  if not exists (
    select 1 from public.platform_tenant_domain_claims
    where domain = p_domain and tenant_id = p_tenant_id
      and host_id = p_host_id and verification_token = p_verification_token
  ) or not exists (
    select 1 from public.platform_hosts
    where id = p_host_id and status = 'active'
  ) then
    return false;
  end if;

  insert into public.platform_tenant_domains (
    domain, tenant_id, host_id, created_at
  )
  select domain, tenant_id, host_id, p_updated_at
  from public.platform_tenant_domain_claims
  where domain = p_domain and tenant_id = p_tenant_id
    and host_id = p_host_id and verification_token = p_verification_token;
  delete from public.platform_tenant_domain_claims
  where domain = p_domain and tenant_id = p_tenant_id
    and host_id = p_host_id and verification_token = p_verification_token;
  update public.platform_tenants
  set updated_at = p_updated_at
  where id = p_tenant_id and host_id = p_host_id;
  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id, p_actor_id,
    jsonb_build_object('kind', 'host', 'id', p_host_id::text),
    'tenant.domain_verified', 'tenant_domain', p_domain, p_audit_created_at
  );
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.create_platform_tenant_domain_claim(
  uuid, uuid, text, text, timestamptz, text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_platform_tenant_domain_claim(
  uuid, uuid, text, text, timestamptz, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_platform_tenant_domain_claim(
  uuid, uuid, text, text, timestamptz, text, uuid, timestamptz
) to service_role;
grant execute on function public.complete_platform_tenant_domain_claim(
  uuid, uuid, text, text, timestamptz, text, uuid, timestamptz
) to service_role;
