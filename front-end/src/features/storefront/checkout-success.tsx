import Link from "next/link";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";

export function StorefrontCheckoutSuccess({
  locale,
  order,
}: {
  locale: string;
  order: CustomerOrder;
}) {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <section className="space-y-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          Order placed
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-emerald-950">
          Your order has been saved
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          No payment was collected. Payment and fulfillment are not configured
          for this demo checkout.
        </p>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-700">
        <div className="flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Order ID</span>
          <span className="font-semibold text-slate-900">{order.id}</span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Placed</span>
          <span className="font-semibold text-slate-900">
            {dateFormatter.format(new Date(order.createdAt))}
          </span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Status</span>
          <span className="font-semibold text-emerald-700">{order.status}</span>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-slate-900">Order summary</h3>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          {order.items.map((item) => (
            <div
              className="flex items-center justify-between gap-4"
              key={item.productId}
            >
              <div>
                <p className="font-medium text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500">
                  Qty {item.quantity} · {item.slug}
                </p>
              </div>
              <span className="font-medium text-slate-900">
                {formatCurrencyAmount(
                  item.unitPrice * item.quantity,
                  item.currency,
                  locale,
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>
              {formatCurrencyAmount(order.total, order.currency, locale)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href={`/${locale}/products`}
        >
          Continue shopping
        </Link>
        <Link
          className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900"
          href={`/${locale}/account`}
        >
          View account
        </Link>
      </div>
    </section>
  );
}
