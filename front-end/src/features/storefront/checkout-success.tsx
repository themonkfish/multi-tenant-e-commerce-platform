"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useOrderStore } from "@/features/storefront/order-store";

export function StorefrontCheckoutSuccess({ locale }: { locale: string }) {
  const orders = useOrderStore((state) => state.orders);
  const latestOrder = useMemo(() => orders[0] ?? null, [orders]);

  if (!latestOrder) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">No recent order</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your checkout confirmation is not available yet. Start shopping again to place an order.
        </p>
        <Link
          className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href={`/${locale}/products`}
        >
          Browse catalog
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          Order confirmed
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-emerald-950">
          Thanks for your purchase
        </h2>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-700">
        <div className="flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Order ID</span>
          <span className="font-semibold text-slate-900">{latestOrder.id}</span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Placed</span>
          <span className="font-semibold text-slate-900">
            {new Date(latestOrder.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">Status</span>
          <span className="font-semibold text-emerald-700">{latestOrder.status}</span>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-slate-900">Order summary</h3>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          {latestOrder.items.map((item) => (
            <div className="flex items-center justify-between gap-4" key={item.id}>
              <div>
                <p className="font-medium text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500">
                  Qty {item.quantity} · {item.slug}
                </p>
              </div>
              <span className="font-medium text-slate-900">
                {item.quantity * item.price} {item.currency}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between text-sm text-slate-700">
            <span>Subtotal</span>
            <span>{latestOrder.subtotal} {latestOrder.currency}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{latestOrder.total} {latestOrder.currency}</span>
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
