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
revoke all on public.tenant_products, public.tenant_schema_metadata
  from anon, authenticated;
grant all on public.tenant_products, public.tenant_schema_metadata to service_role;

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
    if existing_version < 4 then
      update public.tenant_schema_metadata
        set version = 4, updated_at = now()
        where id = 'tenant-catalog';
      return 4;
    end if;
    return existing_version;
  end if;

  insert into public.tenant_schema_metadata (id, tenant_id, version, updated_at)
    values ('tenant-catalog', p_tenant_id, 4, now());
  return 4;
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
