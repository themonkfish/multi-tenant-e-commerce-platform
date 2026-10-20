"use client";

import Link from "next/link";
import { useOrderStore } from "@/features/storefront/order-store";

export function StorefrontCustomerAccount({ locale }: { locale: string }) {
  const orders = useOrderStore((state) => state.orders);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Account overview
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Welcome back
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This storefront preview keeps order history locally so you can review recent purchases and the latest checkout confirmation.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-slate-900">Recent orders</h3>
          <Link
            className="text-sm font-medium text-slate-700 underline"
            href={`/${locale}/products`}
          >
            Shop more
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-lg font-medium text-slate-900">No orders yet</p>
            <p className="mt-2 text-sm text-slate-600">
              Place an order from the storefront to see it appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <article
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                key={order.id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {order.id}
                    </p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">
                      {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                    </h4>
                  </div>
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {order.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-col justify-between gap-2 text-sm text-slate-600 sm:flex-row">
                  <span>Ordered {new Date(order.createdAt).toLocaleDateString()}</span>
                  <span className="font-semibold text-slate-900">
                    {order.total} {order.currency}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
