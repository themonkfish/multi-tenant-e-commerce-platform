import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("SuperAdminOperations");
  const summary = summarizePlatformOrders(orders);

  return (
    <section aria-labelledby="platform-analytics-heading" className="space-y-4">
      <div>
        <h2 id="platform-analytics-heading" className="text-xl font-semibold">
          {t("analyticsTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analyticsDescription")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("orders")}</p>
          <p className="mt-1 text-2xl font-semibold">{summary.orderCount}</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("paidOrders")}</p>
          <p className="mt-1 text-2xl font-semibold">
            {summary.paidOrderCount}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("codDue")}</p>
          <p className="mt-1 text-2xl font-semibold">{summary.codDueCount}</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("grossTotals")}</p>
          {summary.totalsByCurrency.length === 0 ? (
            <p className="mt-1 font-semibold">{t("none")}</p>
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
