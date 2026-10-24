"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
}: {
  locale: string;
  order: CustomerOrder;
}) {
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
  }, [currentOrder.paymentStatus, order.id]);

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

  return (
    <section className="space-y-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          {currentOrder.paymentStatus === "paid" &&
          currentOrder.paymentMethod === "cash_on_delivery"
            ? "Cash collected"
            : currentOrder.paymentStatus === "paid"
              ? "Payment confirmed"
              : currentOrder.paymentStatus === "cod_due"
                ? "Cash on delivery"
                : currentOrder.paymentStatus === "failed"
                  ? "Payment not completed"
                  : "Payment processing"}
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-emerald-950">
          {currentOrder.paymentStatus === "paid"
            ? "Your order is confirmed"
            : currentOrder.paymentStatus === "cod_due"
              ? "Your order is confirmed"
              : currentOrder.paymentStatus === "failed"
                ? "Your payment was not completed"
                : "We are confirming your payment"}
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          {currentOrder.paymentStatus === "paid"
            ? currentOrder.paymentMethod === "cash_on_delivery"
              ? "The store operator confirmed receipt of cash for this order."
              : "Payment was confirmed by Stripe. Your order has been sent to the store."
            : currentOrder.paymentStatus === "cod_due"
              ? "Your order has been sent to the store. Pay the store operator when it is delivered."
              : currentOrder.paymentStatus === "failed"
                ? "No payment was confirmed. Return to your cart to try checkout again."
                : "Stripe is processing the payment confirmation. This page will update automatically."}
        </p>
      </div>

      {(currentOrder.paymentStatus === "paid" ||
        currentOrder.paymentStatus === "cod_due") && (
        <CustomerOrderSyncStatus initialOrder={currentOrder} />
      )}

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
          <span className="font-semibold text-emerald-700">
            {currentOrder.paymentStatus === "paid"
              ? currentOrder.status
              : currentOrder.paymentStatus === "cod_due"
                ? "Awaiting cash collection"
                : currentOrder.paymentStatus}
          </span>
        </div>
        {currentOrder.deliveryAddress && (
          <div className="mt-3">
            <p className="font-medium text-slate-500">Delivery address</p>
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
        <h3 className="text-lg font-semibold text-slate-900">Order summary</h3>
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
