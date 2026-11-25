"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  CustomerOrderSchema,
  type CustomerOrder,
} from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";
import { CustomerOrderSyncStatus } from "./order-sync-status";
import { useCartStore } from "@/features/storefront/cart-store";

export function StorefrontCheckoutSuccess({
  locale,
  order,
  sessionId,
}: {
  locale: string;
  order: CustomerOrder;
  sessionId?: string;
}) {
  const t = useTranslations("CustomerCheckout");
  const accountT = useTranslations("CustomerAccount");
  const [currentOrder, setCurrentOrder] = useState(order);
  const clearCart = useCartStore((state) => state.clear);

  useEffect(() => {
    if (currentOrder.paymentStatus !== "pending") return;
    let active = true;
    let attempts = 0;
    async function pollPaymentStatus() {
      while (active && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!active) return;
        attempts += 1;
        try {
          if (sessionId) {
            await fetch(
              `/api/customer/orders/${encodeURIComponent(order.id)}/reconcile`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId }),
                cache: "no-store",
              },
            );
          }
          const response = await fetch("/api/customer/orders", {
            cache: "no-store",
          });
          if (!response.ok) continue;
          const body: unknown = await response.json();
          const orders =
            typeof body === "object" && body !== null && "data" in body
              ? body.data
              : null;
          if (!Array.isArray(orders)) continue;
          const latest = orders
            .map((candidate) => CustomerOrderSchema.safeParse(candidate))
            .find(
              (candidate) =>
                candidate.success && candidate.data.id === order.id,
            );
          if (latest?.success) {
            setCurrentOrder(latest.data);
            if (latest.data.paymentStatus !== "pending") return;
          }
        } catch {
          continue;
        }
      }
    }
    void pollPaymentStatus();
    return () => {
      active = false;
    };
  }, [currentOrder.paymentStatus, order.id, sessionId]);

  useEffect(() => {
    if (
      currentOrder.paymentStatus === "paid" ||
      currentOrder.paymentStatus === "cod_due"
    ) {
      clearCart();
    }
  }, [clearCart, currentOrder.paymentStatus]);

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const orderStatusLabels = {
    Confirmed: accountT("orderStatus.confirmed"),
    Processing: accountT("orderStatus.processing"),
    Shipped: accountT("orderStatus.shipped"),
    Delivered: accountT("orderStatus.delivered"),
    Cancelled: accountT("orderStatus.cancelled"),
  };
  const statusLabel =
    currentOrder.paymentStatus === "paid"
      ? orderStatusLabels[currentOrder.status]
      : currentOrder.paymentStatus === "cod_due"
        ? t("awaitingCashCollection")
        : currentOrder.paymentStatus === "pending"
          ? accountT("paymentPending")
          : accountT("paymentFailed");

  return (
    <section className="space-y-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          {currentOrder.paymentStatus === "paid" &&
          currentOrder.paymentMethod === "cash_on_delivery"
            ? t("cashCollected")
            : currentOrder.paymentStatus === "paid"
              ? t("paymentConfirmed")
              : currentOrder.paymentStatus === "cod_due"
                ? t("cashOnDelivery")
                : currentOrder.paymentStatus === "failed"
                  ? t("paymentNotCompleted")
                  : t("paymentProcessing")}
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-emerald-950">
          {currentOrder.paymentStatus === "paid"
            ? t("orderConfirmed")
            : currentOrder.paymentStatus === "cod_due"
              ? t("orderConfirmed")
              : currentOrder.paymentStatus === "failed"
                ? t("paymentIncomplete")
                : t("confirmingPayment")}
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          {currentOrder.paymentStatus === "paid"
            ? currentOrder.paymentMethod === "cash_on_delivery"
              ? t("cashReceiptConfirmed")
              : t("stripePaymentConfirmed")
            : currentOrder.paymentStatus === "cod_due"
              ? t("cashDueOnDelivery")
              : currentOrder.paymentStatus === "failed"
                ? t("paymentWasNotConfirmed")
                : t("stripePaymentProcessing")}
        </p>
      </div>

      {(currentOrder.paymentStatus === "paid" ||
        currentOrder.paymentStatus === "cod_due") && (
        <CustomerOrderSyncStatus initialOrder={currentOrder} />
      )}

      <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-700">
        <div className="flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">{t("orderId")}</span>
          <span className="font-semibold text-slate-900">{order.id}</span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">{t("placed")}</span>
          <span className="font-semibold text-slate-900">
            {dateFormatter.format(new Date(order.createdAt))}
          </span>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row">
          <span className="font-medium text-slate-500">{t("status")}</span>
          <span className="font-semibold text-emerald-700">{statusLabel}</span>
        </div>
        {currentOrder.deliveryAddress && (
          <div className="mt-3">
            <p className="font-medium text-slate-500">{t("deliveryAddress")}</p>
            <p className="mt-1 font-semibold text-slate-900">
              {currentOrder.deliveryAddress.fullName} ·{" "}
              {currentOrder.deliveryAddress.line1}
              {currentOrder.deliveryAddress.line2
                ? `, ${currentOrder.deliveryAddress.line2}`
                : ""}
              , {currentOrder.deliveryAddress.city},{" "}
              {currentOrder.deliveryAddress.state}{" "}
              {currentOrder.deliveryAddress.postalCode}
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-emerald-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-slate-900">
          {t("orderSummary")}
        </h3>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          {currentOrder.items.map((item) => (
            <div
              className="flex items-center justify-between gap-4"
              key={`${item.productId}:${JSON.stringify(item.variantSelections ?? {})}`}
            >
              <div>
                <p className="font-medium text-slate-900">{item.title}</p>
                {item.variantSelections && (
                  <p className="text-xs text-slate-600">
                    {Object.entries(item.variantSelections)
                      .map(([name, value]) => `${name}: ${value}`)
                      .join(" · ")}
                  </p>
                )}
                {item.sku && (
                  <p className="text-sm text-slate-500">SKU: {item.sku}</p>
                )}
                <p className="text-xs text-slate-500">
                  {t("quantityAndSlug", {
                    quantity: item.quantity,
                    slug: item.slug,
                  })}
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
          <div className="mb-3 flex items-center justify-between text-sm text-slate-700">
            <span>{t("subtotal")}</span>
            <span>
              {formatCurrencyAmount(
                currentOrder.subtotal ??
                  currentOrder.items.reduce(
                    (sum, item) => sum + item.unitPrice * item.quantity,
                    0,
                  ),
                currentOrder.currency,
                locale,
              )}
            </span>
          </div>
          {(currentOrder.discountAmount ?? 0) > 0 && (
            <div className="mb-3 flex items-center justify-between text-sm text-slate-700">
              <span>
                {currentOrder.discountCode
                  ? t("discountWithCode", {
                      code: currentOrder.discountCode,
                    })
                  : t("discount")}
              </span>
              <span>
                −
                {formatCurrencyAmount(
                  currentOrder.discountAmount ?? 0,
                  currentOrder.currency,
                  locale,
                )}
              </span>
            </div>
          )}
          {(currentOrder.taxAmount ?? 0) > 0 && (
            <div className="mb-3 flex items-center justify-between text-sm text-slate-700">
              <span>{t("tax")}</span>
              <span>
                {formatCurrencyAmount(
                  currentOrder.taxAmount ?? 0,
                  currentOrder.currency,
                  locale,
                )}
              </span>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between text-sm text-slate-700">
            <span>{t("shipping")}</span>
            <span>
              {formatCurrencyAmount(
                currentOrder.shippingAmount ?? 0,
                currentOrder.currency,
                locale,
              )}
            </span>
          </div>
          <div className="flex items-center justify-between text-base font-semibold text-slate-900">
            <span>{t("total")}</span>
            <span>
              {formatCurrencyAmount(
                currentOrder.total,
                currentOrder.currency,
                locale,
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href={`/${locale}/products`}
        >
          {t("continueShopping")}
        </Link>
        <Link
          className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900"
          href={`/${locale}/account`}
        >
          {t("viewAccount")}
        </Link>
      </div>
    </section>
  );
}
