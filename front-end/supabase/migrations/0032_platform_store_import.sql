create or replace function public.import_platform_store(
  p_payload jsonb,
  p_cutover boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  counts jsonb;
  target_initialized boolean;
  existing_hosts integer;
  existing_tenants integer;
begin
  select initialized into target_initialized
  from public.platform_state
  where id = 1;

  select count(*) into existing_hosts
  from public.platform_hosts;
  select count(*) into existing_tenants
  from public.platform_tenants;

  if coalesce(target_initialized, false)
    or existing_hosts > 0
    or existing_tenants > 0
  then
    raise exception 'Platform-store target is not empty';
  end if;

  if exists (select 1 from public.platform_super_admins) then
    raise exception 'Platform-store target already contains Super Admin accounts';
  end if;

  update public.platform_state
  set initialized = (p_cutover and coalesce((p_payload->>'initialized')::boolean, false)),
      setup_token_hash = null,
      platform_domain = p_payload->>'platform_domain',
      reserved_subdomains =
        coalesce(
          array(select value::text from jsonb_array_elements_text(
            coalesce(p_payload->'reserved_subdomains', '[]'::jsonb)
          ) as value),
          '{}'
        ),
      platform_settings =
        coalesce(p_payload->'platform_settings', '{}'::jsonb)
  where id = 1;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'super_admins', '[]'::jsonb))
  loop
    insert into public.platform_super_admins (
      id, email, password_hash, totp_secret_ciphertext,
      recovery_code_hashes, created_at
    ) values (
      (r->>'id')::uuid,
      lower(r->>'email'),
      r->>'password_hash',
      r->>'totp_secret_ciphertext',
      coalesce(
        array(select value::text
              from jsonb_array_elements_text(coalesce(r->'recovery_code_hashes', '[]'::jsonb)) as value),
        '{}'
      ),
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'hosts', '[]'::jsonb))
  loop
    insert into public.platform_hosts (
      id, slug, name, status, plan, limits, branding,
      support_contact, created_at, updated_at
    ) values (
      (r->>'id')::uuid,
      r->>'slug',
      r->>'name',
      r->>'status',
      r->>'plan',
      coalesce(r->'limits', '{}'::jsonb),
      coalesce(r->'branding', '{}'::jsonb),
      nullif(r->>'support_contact', ''),
      coalesce((r->>'created_at')::timestamptz, now()),
      coalesce((r->>'updated_at')::timestamptz, now())
    );

    insert into public.platform_host_domains (domain, host_id, created_at)
    select lower(domain.value::text), (r->>'id')::uuid,
           coalesce((r->>'created_at')::timestamptz, now())
    from jsonb_array_elements_text(coalesce(r->'domains', '[]'::jsonb)) domain(value);
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'host_owners', '[]'::jsonb))
  loop
    insert into public.platform_host_owners (
      id, host_id, email, password_hash, created_at
    ) values (
      (r->>'id')::uuid, (r->>'host_id')::uuid, lower(r->>'email'),
      r->>'password_hash', coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'host_owner_invites', '[]'::jsonb))
  loop
    insert into public.platform_host_owner_invites (
      id, host_id, email, token_hash, expires_at, created_at
    ) values (
      (r->>'id')::uuid, (r->>'host_id')::uuid, lower(r->>'email'),
      r->>'token_hash', (r->>'expires_at')::timestamptz,
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenants', '[]'::jsonb))
  loop
    insert into public.platform_tenants (
      id, host_id, slug, name, status, plan, created_at, updated_at
    ) values (
      (r->>'id')::uuid, (r->>'host_id')::uuid, r->>'slug', r->>'name',
      r->>'status', r->>'plan',
      coalesce((r->>'created_at')::timestamptz, now()),
      coalesce((r->>'updated_at')::timestamptz, now())
    );
    insert into public.platform_tenant_domains (domain, tenant_id, host_id, created_at)
    select lower(domain.value::text), (r->>'id')::uuid,
           (r->>'host_id')::uuid,
           coalesce((r->>'created_at')::timestamptz, now())
    from jsonb_array_elements_text(coalesce(r->'domains', '[]'::jsonb)) domain(value);
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_owners', '[]'::jsonb))
  loop
    insert into public.platform_tenant_owners (
      id, tenant_id, host_id, email, password_hash, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      lower(r->>'email'), r->>'password_hash',
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_owner_invites', '[]'::jsonb))
  loop
    insert into public.platform_tenant_owner_invites (
      id, tenant_id, host_id, email, token_hash, expires_at, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      lower(r->>'email'), r->>'token_hash',
      (r->>'expires_at')::timestamptz,
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_staff', '[]'::jsonb))
  loop
    insert into public.platform_tenant_staff (
      id, tenant_id, host_id, email, password_hash, permissions,
      active, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      lower(r->>'email'), r->>'password_hash',
      array(select value::text
            from jsonb_array_elements_text(coalesce(r->'permissions', '[]'::jsonb)) as value),
      coalesce((r->>'active')::boolean, true),
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'customer_accounts', '[]'::jsonb))
  loop
    insert into public.platform_customers (
      id, tenant_id, email, password_hash, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, lower(r->>'email'),
      r->>'password_hash', coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'customer_password_resets', '[]'::jsonb))
  loop
    insert into public.platform_customer_password_resets (
      id, tenant_id, customer_id, token_hash, expires_at, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, (r->>'customer_id')::uuid,
      r->>'token_hash', (r->>'expires_at')::timestamptz,
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'customer_orders', '[]'::jsonb))
  loop
    insert into public.platform_customer_orders (
      id, tenant_id, customer_id, status, created_at, items,
      subtotal, shipping_amount, discount_code, discount_amount,
      tax_rate_basis_points, tax_amount, total, currency, item_count,
      payment_method, payment_status, payment_attempt,
      payment_session_id, payment_intent_id, delivery_address, fulfillment,
      backend_sync_status, backend_sync_error
    ) values (
      r->>'id', (r->>'tenant_id')::uuid, (r->>'customer_id')::uuid,
      r->>'status', coalesce((r->>'created_at')::timestamptz, now()),
      coalesce(r->'items', '[]'::jsonb),
      coalesce((r->>'subtotal')::integer, coalesce((r->>'total')::integer, 0)
        - coalesce((r->>'shipping_amount')::integer, 0)),
      coalesce((r->>'shipping_amount')::integer, 0),
      nullif(r->>'discount_code', ''),
      coalesce((r->>'discount_amount')::integer, 0),
      coalesce((r->>'tax_rate_basis_points')::integer, 0),
      coalesce((r->>'tax_amount')::integer, 0),
      coalesce((r->>'total')::integer, 0),
      r->>'currency', coalesce((r->>'item_count')::integer, 1),
      coalesce(r->>'payment_method', 'demo'),
      coalesce(r->>'payment_status', 'paid'),
      coalesce((r->>'payment_attempt')::integer, 0),
      nullif(r->>'payment_session_id', ''),
      nullif(r->>'payment_intent_id', ''),
      r->'delivery_address',
      r->'fulfillment',
      coalesce(r->>'backend_sync_status', 'pending'),
      nullif(r->>'backend_sync_error', '')
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'discount_redemptions', '[]'::jsonb))
  loop
    insert into public.platform_discount_redemptions (
      tenant_id, order_id, code, status, updated_at
    ) values (
      (r->>'tenant_id')::uuid, r->>'order_id', r->>'code',
      r->>'status', coalesce((r->>'updated_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_settings', '[]'::jsonb))
  loop
    insert into public.platform_tenant_settings (
      tenant_id, host_id, branding, locale, updated_at
    ) values (
      (r->>'tenant_id')::uuid,
      (r->>'host_id')::uuid,
      coalesce(r->'branding', r->'settings'->'branding', '{}'::jsonb),
      coalesce(r->'locale', r->'settings'->'locale', '{}'::jsonb),
      coalesce((r->>'updated_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_rest_connections', '[]'::jsonb))
  loop
    insert into public.platform_tenant_rest_connections (
      tenant_id, host_id, config, updated_at
    ) values (
      (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      r->'config', coalesce((r->>'updated_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_database_providers', '[]'::jsonb))
  loop
    insert into public.platform_tenant_database_providers (
      tenant_id, host_id, config, updated_at
    ) values (
      (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      r->'config', coalesce((r->>'updated_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_storage_providers', '[]'::jsonb))
  loop
    insert into public.platform_tenant_storage_providers (
      tenant_id, host_id, config, updated_at
    ) values (
      (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      r->'config', coalesce((r->>'updated_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'tenant_domain_claims', '[]'::jsonb))
  loop
    insert into public.platform_tenant_domain_claims (
      domain, tenant_id, host_id, verification_token, created_at
    ) values (
      lower(r->>'domain'), (r->>'tenant_id')::uuid, (r->>'host_id')::uuid,
      r->>'verification_token',
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'audit_events', '[]'::jsonb))
  loop
    insert into public.platform_audit_log (
      id, actor_id, scope, action, resource_type, resource_id, created_at
    ) values (
      (r->>'id')::uuid, r->>'actor_id', coalesce(r->'scope', '{}'::jsonb),
      r->>'action', r->>'resource_type', nullif(r->>'resource_id', ''),
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'product_reviews', '[]'::jsonb))
  loop
    insert into public.platform_product_reviews (
      id, tenant_id, product_id, customer_id, rating, title, body, created_at
    ) values (
      (r->>'id')::uuid, (r->>'tenant_id')::uuid, r->>'product_id',
      (r->>'customer_id')::uuid, (r->>'rating')::integer,
      r->>'title', r->>'body',
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  for r in
    select value
    from jsonb_array_elements(coalesce(p_payload->'secrets', '[]'::jsonb))
  loop
    insert into public.platform_secret_vault (
      ref, tenant_id, name, encrypted_value, created_at
    ) values (
      (r->>'ref')::uuid, nullif(r->>'tenant_id', ''),
      r->>'name', r->>'encrypted_value',
      coalesce((r->>'created_at')::timestamptz, now())
    );
  end loop;

  select jsonb_build_object(
    'hosts', (select count(*) from jsonb_array_elements(coalesce(p_payload->'hosts', '[]'::jsonb))),
    'tenants', (select count(*) from jsonb_array_elements(coalesce(p_payload->'tenants', '[]'::jsonb))),
    'superAdmins', (select count(*) from jsonb_array_elements(coalesce(p_payload->'super_admins', '[]'::jsonb))),
    'secrets', (select count(*) from jsonb_array_elements(coalesce(p_payload->'secrets', '[]'::jsonb))),
    'auditEvents', (select count(*) from jsonb_array_elements(coalesce(p_payload->'audit_events', '[]'::jsonb)))
  ) into counts;

  return counts;
end;
$$;

revoke all on function public.import_platform_store(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_platform_store(jsonb, boolean)
  to service_role;

create or replace function public.rollback_platform_store()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.platform_product_reviews;
  delete from public.platform_discount_redemptions;
  delete from public.platform_customer_password_resets;
  delete from public.platform_customer_orders;
  delete from public.platform_customers;
  delete from public.platform_tenant_staff;
  delete from public.platform_tenant_owner_invites;
  delete from public.platform_tenant_owners;
  delete from public.platform_tenant_settings;
  delete from public.platform_tenant_rest_connections;
  delete from public.platform_tenant_database_providers;
  delete from public.platform_tenant_storage_providers;
  delete from public.platform_tenant_domain_claims;
  delete from public.platform_tenant_domains;
  delete from public.platform_tenants;
  delete from public.platform_host_owner_invites;
  delete from public.platform_host_owners;
  delete from public.platform_host_domains;
  delete from public.platform_hosts;
  delete from public.platform_secret_vault;
  delete from public.platform_audit_log;
  delete from public.platform_rate_limits;
  delete from public.platform_super_admins;

  update public.platform_state
  set initialized = false,
      setup_token_hash = null,
      platform_domain = null,
      reserved_subdomains = '{}',
      platform_settings = '{"name":"Multi-tenant Commerce Platform","primaryColor":"#4338CA","accentColor":"#0F766E"}'::jsonb
  where id = 1;

  return true;
end;
$$;

revoke all on function public.rollback_platform_store() from public, anon, authenticated;
grant execute on function public.rollback_platform_store() to service_role;
