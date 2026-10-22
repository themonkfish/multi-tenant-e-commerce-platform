do $$
declare
  permission_constraint record;
begin
  for permission_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.platform_tenant_staff'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%permissions <@%'
  loop
    execute format(
      'alter table public.platform_tenant_staff drop constraint %I',
      permission_constraint.conname
    );
  end loop;
end $$;

alter table public.platform_tenant_staff
  add constraint platform_tenant_staff_permissions_allowed_check
  check (
    permissions <@ array[
      'catalog:read',
      'catalog:write',
      'orders:read',
      'orders:write'
    ]::text[]
  );

alter table public.platform_tenant_staff
  add constraint platform_tenant_staff_order_write_requires_read_check
  check (
    not ('orders:write' = any(permissions))
    or 'orders:read' = any(permissions)
  );
