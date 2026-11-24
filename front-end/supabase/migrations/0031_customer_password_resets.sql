create table if not exists public.platform_customer_password_resets (
  id uuid primary key,
  tenant_id uuid not null,
  customer_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (tenant_id, customer_id)
    references public.platform_customers (tenant_id, id) on delete cascade
);

create index if not exists platform_customer_password_resets_customer_idx
  on public.platform_customer_password_resets (tenant_id, customer_id);

alter table public.platform_customer_password_resets enable row level security;
revoke all on public.platform_customer_password_resets from anon, authenticated;
grant all on public.platform_customer_password_resets to service_role;
