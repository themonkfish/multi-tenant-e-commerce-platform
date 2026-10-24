"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CustomerOrderSchema,
  type CustomerOrder,
} from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";

export function StorefrontDemoCheckout({
  locale,
  order,
}: {
  locale: string;
  order: CustomerOrder;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function simulatePayment(result: "paid" | "failed") {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/customer/orders/${encodeURIComponent(order.id)}/demo-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setError("The simulated payment could not be recorded. Please retry.");
        return;
      }
      const updated =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!updated?.success) {
        setError("The server returned an invalid order status.");
        return;
      }
      if (updated.data.paymentStatus === "paid") {
        router.replace(
          `/${locale}/checkout/success?orderId=${encodeURIComponent(order.id)}`,
        );
      } else {
        router.replace(`/${locale}/cart?payment=failed`);
      }
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Order summary</h2>
      <ul className="mt-4 divide-y divide-slate-100">
        {order.items.map((item) => (
          <li
            className="flex justify-between gap-4 py-3 text-sm"
            key={`${item.productId}:${JSON.stringify(item.variantSelections ?? {})}`}
          >
            <span className="text-slate-700">
              {item.title} × {item.quantity}
              {item.variantSelections && (
                <span className="block text-xs text-slate-500">
                  {Object.entries(item.variantSelections)
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(" · ")}
                </span>
              )}
              {item.sku && (
                <span className="block text-xs text-slate-500">
                  SKU: {item.sku}
                </span>
              )}
            </span>
            <span className="font-medium text-slate-900">
              {formatCurrencyAmount(
                item.unitPrice * item.quantity,
                item.currency,
                locale,
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex justify-between border-t border-slate-200 pt-4 font-semibold">
        <span>Subtotal</span>
        <span>
          {formatCurrencyAmount(
            order.subtotal ?? order.total - (order.shippingAmount ?? 0),
            order.currency,
            locale,
          )}
        </span>
      </p>
      <p className="mt-2 flex justify-between text-sm text-slate-600">
        <span>Shipping</span>
        <span>
          {formatCurrencyAmount(
            order.shippingAmount ?? 0,
            order.currency,
            locale,
          )}
        </span>
      </p>
      <p className="mt-2 flex justify-between border-t border-slate-200 pt-3 font-semibold">
        <span>Total</span>
        <span>{formatCurrencyAmount(order.total, order.currency, locale)}</span>
      </p>
      {error && (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={submitting}
          onClick={() => void simulatePayment("paid")}
          type="button"
        >
          {submitting ? "Recording result…" : "Simulate successful payment"}
        </button>
        <button
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
          disabled={submitting}
          onClick={() => void simulatePayment("failed")}
          type="button"
        >
          Simulate failed payment
        </button>
      </div>
    </section>
  );
}
