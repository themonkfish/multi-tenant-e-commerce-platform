alter table public.platform_customer_orders
  drop constraint if exists platform_customer_orders_payment_method_check,
  drop constraint if exists platform_customer_orders_cod_details_check;

alter table public.platform_customer_orders
  add constraint platform_customer_orders_payment_method_check
    check (payment_method in ('stripe', 'razorpay', 'cash_on_delivery')),
  add constraint platform_customer_orders_cod_details_check
    check (
      (
        payment_method in ('stripe', 'razorpay')
        and payment_status <> 'cod_due'
      )
      or (
        payment_method = 'cash_on_delivery'
        and currency = 'INR'
        and payment_status in ('cod_due', 'paid')
        and payment_attempt = 0
      )
    );
