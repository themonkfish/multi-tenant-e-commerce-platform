create table if not exists public.platform_product_reviews (
  id uuid primary key,
  tenant_id uuid not null,
  product_id text not null check (char_length(product_id) between 1 and 128),
  customer_id uuid not null,
  rating integer not null check (rating between 1 and 5),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null,
  unique (tenant_id, product_id, customer_id),
  foreign key (tenant_id, customer_id)
    references public.platform_customers (tenant_id, id) on delete cascade
);

create index if not exists platform_product_reviews_product_idx
  on public.platform_product_reviews (tenant_id, product_id, created_at desc);

alter table public.platform_product_reviews enable row level security;

revoke all on public.platform_product_reviews
  from anon, authenticated;
grant all on public.platform_product_reviews to service_role;
