create table if not exists public.platform_state (
  id integer primary key check (id = 1),
  initialized boolean not null default false,
  setup_token_hash text,
  platform_domain text,
  reserved_subdomains text[] not null default '{}'
);

insert into public.platform_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.platform_super_admins (
  id uuid primary key,
  email text not null,
  password_hash text not null,
  totp_secret_ciphertext text not null,
  recovery_code_hashes text[] not null default '{}',
  created_at timestamptz not null
);

create unique index if not exists platform_super_admins_email_lower_idx
  on public.platform_super_admins (lower(email));

create table if not exists public.platform_audit_log (
  id uuid primary key,
  actor_id text not null,
  scope jsonb not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  created_at timestamptz not null
);

create table if not exists public.platform_secret_vault (
  ref uuid primary key,
  tenant_id text,
  name text not null,
  encrypted_value text not null,
  created_at timestamptz not null
);

create table if not exists public.platform_rate_limits (
  key_hash text primary key,
  count integer not null check (count >= 0),
  reset_at timestamptz not null
);

alter table public.platform_state enable row level security;
alter table public.platform_super_admins enable row level security;
alter table public.platform_audit_log enable row level security;
alter table public.platform_secret_vault enable row level security;
alter table public.platform_rate_limits enable row level security;

revoke all on public.platform_state, public.platform_super_admins,
  public.platform_audit_log, public.platform_secret_vault,
  public.platform_rate_limits from anon, authenticated;
grant all on public.platform_state, public.platform_super_admins,
  public.platform_audit_log, public.platform_secret_vault,
  public.platform_rate_limits to service_role;

create or replace function public.claim_platform_bootstrap(
  p_setup_token_hash text,
  p_platform_domain text,
  p_reserved_subdomains text[],
  p_admin_id uuid,
  p_admin_email text,
  p_password_hash text,
  p_totp_secret_ciphertext text,
  p_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.platform_state
  set setup_token_hash = p_setup_token_hash,
      platform_domain = p_platform_domain,
      reserved_subdomains = p_reserved_subdomains
  where id = 1 and initialized = false and setup_token_hash is null;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return false;
  end if;

  insert into public.platform_super_admins (
    id, email, password_hash, totp_secret_ciphertext, created_at
  ) values (
    p_admin_id, lower(p_admin_email), p_password_hash,
    p_totp_secret_ciphertext, p_created_at
  );

  return true;
end;
$$;

create or replace function public.finalize_platform_bootstrap(
  p_setup_token_hash text,
  p_admin_id uuid,
  p_recovery_code_hashes text[],
  p_audit_id uuid,
  p_audit_actor_id text,
  p_audit_action text,
  p_audit_resource_type text,
  p_audit_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.platform_state
  set initialized = true, setup_token_hash = null
  where id = 1
    and initialized = false
    and setup_token_hash = p_setup_token_hash;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return false;
  end if;

  update public.platform_super_admins
  set recovery_code_hashes = p_recovery_code_hashes
  where id = p_admin_id;

  if not found then
    raise exception 'bootstrap administrator not found';
  end if;

  insert into public.platform_audit_log (
    id, actor_id, scope, action, resource_type, created_at
  ) values (
    p_audit_id,
    p_audit_actor_id,
    '{"kind":"platform","id":"platform"}'::jsonb,
    p_audit_action,
    p_audit_resource_type,
    p_audit_created_at
  );

  return true;
end;
$$;

create or replace function public.consume_platform_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_ms integer,
  p_now timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  delete from public.platform_rate_limits
  where reset_at < p_now - interval '1 day';

  insert into public.platform_rate_limits (key_hash, count, reset_at)
  values (p_key_hash, 1, p_now + (p_window_ms * interval '1 millisecond'))
  on conflict (key_hash) do update
    set count = case
          when public.platform_rate_limits.reset_at <= p_now then 1
          else public.platform_rate_limits.count + 1
        end,
        reset_at = case
          when public.platform_rate_limits.reset_at <= p_now
            then p_now + (p_window_ms * interval '1 millisecond')
          else public.platform_rate_limits.reset_at
        end
    where public.platform_rate_limits.reset_at <= p_now
       or public.platform_rate_limits.count < p_limit
  returning count <= p_limit into allowed;

  return coalesce(allowed, false);
end;
$$;

create or replace function public.consume_platform_recovery_code(
  p_admin_id uuid,
  p_code_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.platform_super_admins
  set recovery_code_hashes = array_remove(recovery_code_hashes, p_code_hash)
  where id = p_admin_id
    and p_code_hash = any(recovery_code_hashes);

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

revoke all on function public.claim_platform_bootstrap(text, text, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_platform_bootstrap(text, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_platform_rate_limit(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_platform_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_platform_bootstrap(text, text, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.finalize_platform_bootstrap(text, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.consume_platform_rate_limit(text, integer, integer, timestamptz) to service_role;
grant execute on function public.consume_platform_recovery_code(uuid, text) to service_role;
