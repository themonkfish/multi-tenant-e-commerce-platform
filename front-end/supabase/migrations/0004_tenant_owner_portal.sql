create unique index if not exists platform_tenants_id_host_id_idx
  on public.platform_tenants (id, host_id);

create table if not exists public.platform_tenant_owners (
  id uuid primary key,
  tenant_id uuid not null unique,
  host_id uuid not null,
  email text not null check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null,
  foreign key (tenant_id, host_id)
    references public.platform_tenants (id, host_id) on delete cascade
);

create unique index if not exists platform_tenant_owners_email_idx
  on public.platform_tenant_owners (email);

create table if not exists public.platform_tenant_owner_invites (
  id uuid primary key,
  tenant_id uuid not null,
  host_id uuid not null,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  unique (tenant_id, email),
  foreign key (tenant_id, host_id)
    references public.platform_tenants (id, host_id) on delete cascade
);

alter table public.platform_tenant_owners enable row level security;
alter table public.platform_tenant_owner_invites enable row level security;
revoke all on public.platform_tenant_owners,
  public.platform_tenant_owner_invites from anon, authenticated;
grant all on public.platform_tenant_owners,
  public.platform_tenant_owner_invites to service_role;

create or replace function public.create_platform_tenant_owner_invite(
  p_invite_id uuid,
  p_tenant_id uuid,
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
    hashtextextended(p_tenant_id::text || ':' || lower(p_email), 0)
  );

  if not exists (
    select 1
    from public.platform_tenants tenant
    join public.platform_hosts host on host.id = tenant.host_id
    where tenant.id = p_tenant_id
      and tenant.host_id = p_host_id
      and tenant.status = 'active'
      and host.status = 'active'
  ) or exists (
    select 1 from public.platform_tenant_owners
    where email = lower(p_email) or tenant_id = p_tenant_id
  ) then
    return false;
  end if;

  delete from public.platform_tenant_owner_invites
  where tenant_id = p_tenant_id and email = lower(p_email);

  insert into public.platform_tenant_owner_invites (
    id, tenant_id, host_id, email, token_hash, expires_at, created_at
  ) values (
    p_invite_id, p_tenant_id, p_host_id, lower(p_email), p_token_hash,
    p_expires_at, p_created_at
  );

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
    'tenant_owner_invite',
    p_audit_resource_id,
    p_audit_created_at
  );

  return true;
end;
$$;

create or replace function public.accept_platform_tenant_owner_invite(
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
  invite_row public.platform_tenant_owner_invites%rowtype;
  owner_row public.platform_tenant_owners%rowtype;
begin
  select * into invite_row
  from public.platform_tenant_owner_invites
  where token_hash = p_token_hash and expires_at > p_now
  for update;

  if not found or not exists (
    select 1
    from public.platform_tenants tenant
    join public.platform_hosts host on host.id = tenant.host_id
    where tenant.id = invite_row.tenant_id
      and tenant.host_id = invite_row.host_id
      and tenant.status = 'active'
      and host.status = 'active'
  ) or exists (
    select 1 from public.platform_tenant_owners
    where email = invite_row.email
  ) then
    return null;
  end if;

  insert into public.platform_tenant_owners (
    id, tenant_id, host_id, email, password_hash, created_at
  ) values (
    p_owner_id, invite_row.tenant_id, invite_row.host_id, invite_row.email,
    p_password_hash, p_now
  ) returning * into owner_row;

  delete from public.platform_tenant_owner_invites
  where tenant_id = invite_row.tenant_id;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, resource_id, created_at
  ) values (
    p_audit_id,
    p_audit_actor_id,
    jsonb_build_object(
      'kind', 'tenant',
      'id', invite_row.tenant_id::text,
      'hostId', invite_row.host_id::text
    ),
    p_audit_action,
    'tenant_owner',
    owner_row.id::text,
    p_audit_created_at
  );

  return jsonb_build_object(
    'id', owner_row.id,
    'tenantId', owner_row.tenant_id,
    'hostId', owner_row.host_id,
    'email', owner_row.email,
    'passwordHash', owner_row.password_hash,
    'createdAt', owner_row.created_at
  );
exception when unique_violation then
  return null;
end;
$$;

revoke all on function public.create_platform_tenant_owner_invite(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text,
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.accept_platform_tenant_owner_invite(
  text, uuid, text, timestamptz, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_platform_tenant_owner_invite(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text,
  text, timestamptz
) to service_role;
grant execute on function public.accept_platform_tenant_owner_invite(
  text, uuid, text, timestamptz, uuid, text, text, timestamptz
) to service_role;
