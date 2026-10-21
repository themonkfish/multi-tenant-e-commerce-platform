create table if not exists public.platform_tenant_staff (
  id uuid primary key,
  tenant_id uuid not null,
  host_id uuid not null,
  email text not null check (email = lower(email)),
  password_hash text not null,
  permissions text[] not null
    check (cardinality(permissions) > 0)
    check (permissions <@ array['catalog:read', 'catalog:write']::text[])
    check (
      not ('catalog:write' = any(permissions))
      or 'catalog:read' = any(permissions)
    ),
  active boolean not null default true,
  created_at timestamptz not null,
  unique (tenant_id, email),
  foreign key (tenant_id, host_id)
    references public.platform_tenants (id, host_id) on delete cascade
);

create table if not exists public.platform_customers (
  id uuid primary key,
  tenant_id uuid not null references public.platform_tenants (id) on delete cascade,
  email text not null check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null,
  unique (tenant_id, email),
  unique (tenant_id, id)
);

create table if not exists public.platform_customer_orders (
  id text not null,
  tenant_id uuid not null,
  customer_id uuid not null,
  status text not null check (status in ('Confirmed', 'Processing', 'Shipped')),
  created_at timestamptz not null,
  total integer not null check (total >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  item_count integer not null check (item_count > 0),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references public.platform_customers (tenant_id, id) on delete cascade
);

create index if not exists platform_customer_orders_owner_idx
  on public.platform_customer_orders (tenant_id, customer_id, created_at desc);

alter table public.platform_tenant_staff enable row level security;
alter table public.platform_customers enable row level security;
alter table public.platform_customer_orders enable row level security;

revoke all on public.platform_tenant_staff,
  public.platform_customers,
  public.platform_customer_orders from anon, authenticated;
grant all on public.platform_tenant_staff,
  public.platform_customers,
  public.platform_customer_orders to service_role;
