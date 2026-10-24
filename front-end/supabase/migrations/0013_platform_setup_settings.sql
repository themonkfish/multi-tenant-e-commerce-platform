alter table public.platform_state
  add column if not exists platform_settings jsonb not null
    default '{"name":"Multi-tenant Commerce Platform","primaryColor":"#4338CA","accentColor":"#0F766E"}'::jsonb;

create or replace function public.claim_platform_bootstrap_with_settings(
  p_setup_token_hash text,
  p_platform_domain text,
  p_reserved_subdomains text[],
  p_platform_settings jsonb,
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
      reserved_subdomains = p_reserved_subdomains,
      platform_settings = p_platform_settings
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

revoke all on function public.claim_platform_bootstrap_with_settings(
  text, text, text[], jsonb, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_platform_bootstrap_with_settings(
  text, text, text[], jsonb, uuid, text, text, text, timestamptz
) to service_role;
