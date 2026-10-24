alter table public.platform_customer_orders
  add column if not exists fulfillment jsonb;

alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_fulfillment_check,
  add constraint platform_customer_orders_fulfillment_check
    check (
      fulfillment is null
      or (
        jsonb_typeof(fulfillment) = 'object'
        and jsonb_typeof(fulfillment->'trackingNumber') = 'string'
        and length(trim(fulfillment->>'trackingNumber')) between 1 and 120
        and (
          fulfillment->>'trackingUrl' is null
          or fulfillment->>'trackingUrl' ~ '^https://'
        )
      )
    );
