create table if not exists public.tenant_products (
  id uuid primary key,
  tenant_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  slug text not null check (char_length(slug) between 1 and 200),
  status text not null check (status in ('draft', 'active', 'archived')),
  price_amount integer not null check (price_amount >= 0),
  price_currency text not null check (price_currency ~ '^[A-Z]{3}$'),
  sku text check (sku is null or char_length(sku) <= 100),
  category text check (
    category is null or char_length(category) between 1 and 80
  ),
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array'),
  variants jsonb
    check (variants is null or jsonb_typeof(variants) = 'array'),
  variant_pricing jsonb
    check (variant_pricing is null or jsonb_typeof(variant_pricing) = 'array'),
  image_url text check (
    image_url is null or
    (image_url ~ '^https://' and char_length(image_url) <= 2048)
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, slug)
);

alter table public.tenant_products
  add column if not exists image_url text
  check (
    image_url is null or
    (image_url ~ '^https://' and char_length(image_url) <= 2048)
  );

alter table public.tenant_products
  add column if not exists category text
  check (category is null or char_length(category) between 1 and 80);

alter table public.tenant_products
  add column if not exists options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(options) = 'array');

alter table public.tenant_products
  add column if not exists variants jsonb
  check (variants is null or jsonb_typeof(variants) = 'array');

alter table public.tenant_products
  add column if not exists variant_pricing jsonb
  check (
    variant_pricing is null or jsonb_typeof(variant_pricing) = 'array'
  );

create table if not exists public.tenant_inventory_reservations (
  tenant_id uuid not null,
  reservation_id text not null check (char_length(reservation_id) between 1 and 128),
  status text not null check (status in ('reserved', 'released', 'committed')),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reservation_id)
);

create index if not exists tenant_products_tenant_created_idx
  on public.tenant_products (tenant_id, created_at desc);

create table if not exists public.tenant_schema_metadata (
  id text primary key check (id = 'tenant-catalog'),
  tenant_id uuid not null,
  version integer not null check (version >= 0),
  updated_at timestamptz not null
);

alter table public.tenant_products enable row level security;
alter table public.tenant_schema_metadata enable row level security;
alter table public.tenant_inventory_reservations enable row level security;
revoke all on public.tenant_products, public.tenant_schema_metadata
  from anon, authenticated;
grant all on public.tenant_products, public.tenant_schema_metadata to service_role;
revoke all on public.tenant_inventory_reservations from anon, authenticated;
grant all on public.tenant_inventory_reservations to service_role;

drop policy if exists tenant_products_service_role on public.tenant_products;
create policy tenant_products_service_role on public.tenant_products
  for all to service_role using (true) with check (true);

drop policy if exists tenant_schema_metadata_service_role
  on public.tenant_schema_metadata;
create policy tenant_schema_metadata_service_role
  on public.tenant_schema_metadata
  for all to service_role using (true) with check (true);

create or replace function public.initialize_tenant_catalog(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_tenant_id uuid;
  existing_version integer;
begin
  if p_tenant_id is null then
    raise exception 'Tenant id is required';
  end if;

  select tenant_id, version
    into existing_tenant_id, existing_version
    from public.tenant_schema_metadata
    where id = 'tenant-catalog'
    for update;

  if found then
    if existing_tenant_id <> p_tenant_id then
      raise exception 'This Supabase project is initialized for another tenant';
    end if;
    if existing_version < 6 then
      update public.tenant_schema_metadata
        set version = 6, updated_at = now()
        where id = 'tenant-catalog';
      return 6;
    end if;
    return existing_version;
  end if;

  insert into public.tenant_schema_metadata (id, tenant_id, version, updated_at)
    values ('tenant-catalog', p_tenant_id, 6, now());
  return 6;
end;
$$;

revoke all on function public.initialize_tenant_catalog(uuid)
  from public, anon, authenticated;
grant execute on function public.initialize_tenant_catalog(uuid) to service_role;

create or replace function public.list_tenant_product_categories(
  p_tenant_id uuid,
  p_status text default null
)
returns table(category text)
language sql
security definer
set search_path = ''
as $$
  select distinct products.category
    from public.tenant_products as products
    where products.tenant_id = p_tenant_id
      and products.category is not null
      and (p_status is null or products.status = p_status)
    order by products.category;
$$;

revoke all on function public.list_tenant_product_categories(uuid, text)
  from public, anon, authenticated;
grant execute on function public.list_tenant_product_categories(uuid, text)
  to service_role;

create or replace function public.reserve_tenant_product_inventory(
  p_tenant_id uuid,
  p_reservation_id text,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_status text;
  prior_items jsonb;
  item jsonb;
  product_variants jsonb;
  variant_index integer;
  current_stock integer;
  requested_quantity integer;
begin
  if p_tenant_id is null or p_reservation_id is null or
     jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'Invalid inventory reservation';
  end if;

  select status, items into prior_status, prior_items
    from public.tenant_inventory_reservations
    where tenant_id = p_tenant_id and reservation_id = p_reservation_id
    for update;
  if found then
    return prior_status in ('reserved', 'committed')
      and prior_items = p_items;
  end if;

  begin
    insert into public.tenant_inventory_reservations
      (tenant_id, reservation_id, status, items)
      values (p_tenant_id, p_reservation_id, 'reserved', p_items)
      on conflict (tenant_id, reservation_id) do nothing;
    if not found then
      select status, items into prior_status, prior_items
        from public.tenant_inventory_reservations
        where tenant_id = p_tenant_id
          and reservation_id = p_reservation_id
        for update;
      return prior_status in ('reserved', 'committed')
        and prior_items = p_items;
    end if;

    for item in select value from jsonb_array_elements(p_items)
    loop
      requested_quantity := (item ->> 'quantity')::integer;
      select variants into product_variants
        from public.tenant_products
        where tenant_id = p_tenant_id and id = (item ->> 'productId')::uuid
        for update;
      if not found or product_variants is null then
        raise exception 'Insufficient inventory' using errcode = 'P0001';
      end if;

      select (entry.ordinality - 1)::integer,
             (entry.value ->> 'stock')::integer
        into variant_index, current_stock
        from jsonb_array_elements(product_variants) with ordinality as entry(value, ordinality)
        where entry.value -> 'selections' = item -> 'selections';
      if variant_index is null or current_stock < requested_quantity then
        raise exception 'Insufficient inventory' using errcode = 'P0001';
      end if;

      update public.tenant_products
        set variants = jsonb_set(
          product_variants,
          array[variant_index::text, 'stock'],
          to_jsonb(current_stock - requested_quantity)
        ),
        updated_at = now()
        where tenant_id = p_tenant_id and id = (item ->> 'productId')::uuid;
    end loop;

  exception when sqlstate 'P0001' then
    return false;
  end;
  return true;
end;
$$;

create or replace function public.release_tenant_product_inventory(
  p_tenant_id uuid,
  p_reservation_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_items jsonb;
  item jsonb;
  product_variants jsonb;
  variant_index integer;
  current_stock integer;
  requested_quantity integer;
begin
  select items into reservation_items
    from public.tenant_inventory_reservations
    where tenant_id = p_tenant_id
      and reservation_id = p_reservation_id
      and status = 'reserved'
    for update;
  if not found then return; end if;

  for item in select value from jsonb_array_elements(reservation_items)
  loop
    requested_quantity := (item ->> 'quantity')::integer;
    select variants into product_variants
      from public.tenant_products
      where tenant_id = p_tenant_id and id = (item ->> 'productId')::uuid
      for update;
    select (entry.ordinality - 1)::integer,
           (entry.value ->> 'stock')::integer
      into variant_index, current_stock
      from jsonb_array_elements(product_variants) with ordinality as entry(value, ordinality)
      where entry.value -> 'selections' = item -> 'selections';
    if variant_index is null then
      raise exception 'Reserved inventory variant no longer exists';
    end if;
    update public.tenant_products
      set variants = jsonb_set(
        product_variants,
        array[variant_index::text, 'stock'],
        to_jsonb(current_stock + requested_quantity)
      ),
      updated_at = now()
      where tenant_id = p_tenant_id and id = (item ->> 'productId')::uuid;
  end loop;

  update public.tenant_inventory_reservations
    set status = 'released', updated_at = now()
    where tenant_id = p_tenant_id and reservation_id = p_reservation_id;
end;
$$;

create or replace function public.commit_tenant_product_inventory(
  p_tenant_id uuid,
  p_reservation_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tenant_inventory_reservations
    set status = 'committed', updated_at = now()
    where tenant_id = p_tenant_id
      and reservation_id = p_reservation_id
      and status = 'reserved';
$$;

revoke all on function public.reserve_tenant_product_inventory(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_tenant_product_inventory(uuid, text)
  from public, anon, authenticated;
revoke all on function public.commit_tenant_product_inventory(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_tenant_product_inventory(uuid, text, jsonb)
  to service_role;
grant execute on function public.release_tenant_product_inventory(uuid, text)
  to service_role;
grant execute on function public.commit_tenant_product_inventory(uuid, text)
  to service_role;
