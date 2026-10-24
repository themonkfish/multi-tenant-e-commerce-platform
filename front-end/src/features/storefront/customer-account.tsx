"use client";

import Link from "next/link";
import { useOrderStore } from "@/features/storefront/order-store";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";
import { CustomerOrderSyncStatus } from "./order-sync-status";

export function StorefrontCustomerAccount({
  locale,
  customer,
}: {
  locale: string;
  customer: { email: string; orders: CustomerOrder[] } | null;
}) {
  const previewOrders = useOrderStore((state) => state.orders);
  const orders = customer?.orders ?? previewOrders;
  const orderDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Account overview
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          {customer ? `Welcome, ${customer.email}` : "Order preview"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {customer
            ? "These orders are loaded from your private account in this store."
            : "Preview orders are stored only in this browser. Sign in to view tenant-scoped account orders."}
        </p>
        {customer ? (
          <form
            action="/api/customer/auth/logout"
            method="post"
            className="mt-4"
          >
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
              type="submit"
            >
              Sign out
            </button>
          </form>
        ) : (
          <Link
            className="mt-4 inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white"
            href={`/${locale}/customer/login`}
          >
            Sign in or create account
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-slate-900">
            Recent orders
          </h3>
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
              Orders you place while signed in will appear here.
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
                    {"paymentMethod" in order &&
                    order.paymentMethod === "cash_on_delivery" &&
                    order.paymentStatus === "cod_due"
                      ? "Cash due on delivery"
                      : "paymentMethod" in order &&
                          order.paymentMethod === "cash_on_delivery" &&
                          order.paymentStatus === "paid"
                        ? "Cash collected"
                        : "paymentStatus" in order &&
                            order.paymentStatus !== "paid"
                          ? `Payment ${order.paymentStatus}`
                          : order.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-col justify-between gap-2 text-sm text-slate-600 sm:flex-row">
                  <span>
                    Ordered{" "}
                    {orderDateFormatter.format(new Date(order.createdAt))}
                  </span>
                  <span className="font-semibold text-slate-900">
                    {customer
                      ? formatCurrencyAmount(
                          order.total,
                          order.currency,
                          locale,
                        )
                      : `${order.total} ${order.currency}`}
                  </span>
                </div>
                {customer &&
                  "shippingAmount" in order &&
                  (order.shippingAmount ?? 0) > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      Includes{" "}
                      {formatCurrencyAmount(
                        order.shippingAmount ?? 0,
                        order.currency,
                        locale,
                      )}{" "}
                      shipping
                    </p>
                  )}
                {customer &&
                  "discountAmount" in order &&
                  (order.discountAmount ?? 0) > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      Discount
                      {"discountCode" in order && order.discountCode
                        ? ` (${order.discountCode})`
                        : ""}
                      : −
                      {formatCurrencyAmount(
                        order.discountAmount ?? 0,
                        order.currency,
                        locale,
                      )}
                    </p>
                  )}
                {"deliveryAddress" in order && order.deliveryAddress && (
                  <p className="mt-3 text-sm text-slate-600">
                    Deliver to {order.deliveryAddress.fullName},{" "}
                    {order.deliveryAddress.line1}, {order.deliveryAddress.city}
                  </p>
                )}
                {"fulfillment" in order && order.fulfillment && (
                  <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <p className="font-medium text-slate-900">
                      Shipment tracking
                    </p>
                    <p className="mt-1 text-slate-700">
                      {order.fulfillment.carrier
                        ? `${order.fulfillment.carrier} · `
                        : ""}
                      {order.fulfillment.trackingNumber}
                    </p>
                    {order.fulfillment.trackingUrl && (
                      <a
                        className="mt-1 inline-block font-medium text-indigo-700 underline"
                        href={order.fulfillment.trackingUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Track shipment
                      </a>
                    )}
                  </div>
                )}
                {customer &&
                  "backendSyncStatus" in order &&
                  order.backendSyncStatus !== "synced" && (
                    <div className="mt-4">
                      <CustomerOrderSyncStatus initialOrder={order} />
                    </div>
                  )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
