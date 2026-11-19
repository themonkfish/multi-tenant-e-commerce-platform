import type { CustomerOrder } from "@/core/domain/tenant-identities";

export function summarizePlatformOrders(orders: CustomerOrder[]) {
  const totalsByCurrency = new Map<string, number>();
  let paidOrderCount = 0;
  let codDueCount = 0;

  for (const order of orders) {
    totalsByCurrency.set(
      order.currency,
      (totalsByCurrency.get(order.currency) ?? 0) + order.total,
    );
    if (order.paymentStatus === "paid") {
      paidOrderCount += 1;
    }
    if (order.paymentStatus === "cod_due") {
      codDueCount += 1;
    }
  }

  return {
    orderCount: orders.length,
    paidOrderCount,
    codDueCount,
    totalsByCurrency: [...totalsByCurrency.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  };
}

export function PlatformAnalyticsSummary({
  orders,
}: {
  orders: CustomerOrder[];
}) {
  const summary = summarizePlatformOrders(orders);

  return (
    <section aria-labelledby="platform-analytics-heading" className="space-y-4">
      <div>
        <h2 id="platform-analytics-heading" className="text-xl font-semibold">
          Platform analytics
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Persisted order totals across all tenant scopes. Totals are grouped by
          currency and remain in minor units.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Orders</p>
          <p className="mt-1 text-2xl font-semibold">{summary.orderCount}</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Paid orders</p>
          <p className="mt-1 text-2xl font-semibold">
            {summary.paidOrderCount}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">COD due</p>
          <p className="mt-1 text-2xl font-semibold">{summary.codDueCount}</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Gross order totals</p>
          {summary.totalsByCurrency.length === 0 ? (
            <p className="mt-1 font-semibold">None</p>
          ) : (
            <ul className="mt-1 space-y-1 font-semibold">
              {summary.totalsByCurrency.map(([currency, amount]) => (
                <li key={currency}>
                  {currency}: {amount.toLocaleString("en")}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
