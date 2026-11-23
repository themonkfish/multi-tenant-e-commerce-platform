"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useOrderStore } from "@/features/storefront/order-store";
import { formatCurrencyAmount } from "@/core/domain/money";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { CustomerOrderSyncStatus } from "./order-sync-status";
import { CustomerOrderProgress } from "./customer-order-progress";

export function StorefrontCustomerAccount({
  locale,
  customer,
}: {
  locale: string;
  customer: { email: string; orders: CustomerOrder[] } | null;
}) {
  const router = useRouter();
  const t = useTranslations("CustomerAccount");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(
    null,
  );
  const previewOrders = useOrderStore((state) => state.orders);
  const orders = customer?.orders ?? previewOrders;
  const orderDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  async function deleteAccount() {
    if (!window.confirm(t("deleteAccountConfirm"))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/customer/auth/account", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(t("deleteAccountFailure"));
        return;
      }
      router.push(`/${locale}/account`);
    } catch {
      setError(t("accountRequestFailure"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(orderId: string) {
    if (!window.confirm(t("cancelOrderConfirm"))) {
      return;
    }
    setCancellingOrderId(orderId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/customer/orders/${encodeURIComponent(orderId)}/cancel`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body: unknown = await response.json();
        setError(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            body.error === "order_sync_pending"
            ? t("cancelOrderSyncRequired")
            : t("cancelOrderFailure"),
        );
        router.refresh();
        return;
      }
      setNotice(t("orderCancelled", { orderId }));
      router.refresh();
    } catch {
      setError(t("cancellationRequestFailure"));
    } finally {
      setCancellingOrderId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {t("accountOverview")}
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          {customer
            ? t("welcome", { email: customer.email })
            : t("orderPreview")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {customer
            ? t("customerOrdersDescription")
            : t("previewOrdersDescription")}
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 text-sm text-emerald-700" role="status">
            {notice}
          </p>
        )}
        {customer ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action="/api/customer/auth/logout" method="post">
              <button
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
                type="submit"
              >
                {t("signOut")}
              </button>
            </form>
            <button
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => void deleteAccount()}
              type="button"
            >
              {busy ? t("deleting") : t("deleteAccount")}
            </button>
          </div>
        ) : (
          <Link
            className="mt-4 inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white"
            href={`/${locale}/customer/login`}
          >
            {t("signIn")}
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-slate-900">
            {t("recentOrders")}
          </h3>
          <Link
            className="text-sm font-medium text-slate-700 underline"
            href={`/${locale}/products`}
          >
            {t("shopMore")}
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-lg font-medium text-slate-900">
              {t("noOrders")}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {t("noOrdersDescription")}
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
                      {t("items", { count: order.itemCount })}
                    </h4>
                  </div>
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {order.status === "Cancelled"
                      ? t("orderStatus.cancelled")
                      : "paymentMethod" in order &&
                          order.paymentMethod === "cash_on_delivery" &&
                          order.paymentStatus === "cod_due"
                        ? t("cashDue")
                        : "paymentMethod" in order &&
                            order.paymentMethod === "cash_on_delivery" &&
                            order.paymentStatus === "paid"
                          ? t("cashCollected")
                          : "paymentStatus" in order &&
                              order.paymentStatus !== "paid"
                            ? order.paymentStatus === "pending"
                              ? t("paymentPending")
                              : order.paymentStatus === "refunded"
                                ? t("paymentRefunded")
                                : t("paymentFailed")
                            : order.status === "Confirmed"
                              ? t("orderStatus.confirmed")
                              : order.status === "Processing"
                                ? t("orderStatus.processing")
                                : order.status === "Shipped"
                                  ? t("orderStatus.shipped")
                                  : t("orderStatus.delivered")}
                  </span>
                </div>

                <div className="mt-3 flex flex-col justify-between gap-2 text-sm text-slate-600 sm:flex-row">
                  <span>
                    {t("ordered", {
                      date: orderDateFormatter.format(
                        new Date(order.createdAt),
                      ),
                    })}
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
                {customer && <CustomerOrderProgress status={order.status} />}
                {customer &&
                  "shippingAmount" in order &&
                  (order.shippingAmount ?? 0) > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      {t("includesShipping", {
                        amount: formatCurrencyAmount(
                          order.shippingAmount ?? 0,
                          order.currency,
                          locale,
                        ),
                      })}
                    </p>
                  )}
                {customer &&
                  "discountAmount" in order &&
                  (order.discountAmount ?? 0) > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      {t("discount")}
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
                {customer &&
                  "taxAmount" in order &&
                  (order.taxAmount ?? 0) > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      {t("includesTax", {
                        amount: formatCurrencyAmount(
                          order.taxAmount ?? 0,
                          order.currency,
                          locale,
                        ),
                      })}
                    </p>
                  )}
                {"deliveryAddress" in order && order.deliveryAddress && (
                  <p className="mt-3 text-sm text-slate-600">
                    {t("deliverTo", {
                      name: order.deliveryAddress.fullName,
                      address: order.deliveryAddress.line1,
                      city: order.deliveryAddress.city,
                    })}
                  </p>
                )}
                {"fulfillment" in order && order.fulfillment && (
                  <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <p className="font-medium text-slate-900">
                      {t("shipmentTracking")}
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
                        {t("trackShipment")}
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
                {customer &&
                  "paymentMethod" in order &&
                  order.paymentMethod === "cash_on_delivery" &&
                  order.paymentStatus === "cod_due" &&
                  ((order.status === "Confirmed" &&
                    order.backendSyncStatus === "synced") ||
                    (order.status === "Cancelled" &&
                      order.backendSyncStatus !== "synced")) && (
                    <button
                      className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                      disabled={busy || cancellingOrderId !== null}
                      onClick={() => void cancelOrder(order.id)}
                      type="button"
                    >
                      {cancellingOrderId === order.id
                        ? t("cancelling")
                        : order.status === "Cancelled"
                          ? t("retryCancellation")
                          : t("cancelOrder")}
                    </button>
                  )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
