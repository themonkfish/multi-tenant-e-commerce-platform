"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CustomerOrderSchema } from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";
import { useCartStore } from "@/features/storefront/cart-store";

export function StorefrontCartPage({
  locale,
  signedIn,
}: {
  locale: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clear = useCartStore((state) => state.clear);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");

  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.quantity * item.price, 0),
    [items],
  );

  async function onCheckout() {
    if (!signedIn) {
      router.push(
        `/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`,
      );
      return;
    }

    setCheckingOut(true);
    setError("");
    try {
      const response = await fetch("/api/customer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          items: items.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
          })),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        if (code === "customer_sign_in_required") {
          router.push(
            `/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`,
          );
          return;
        }
        setError(
          code === "cart_changed"
            ? "A product changed or is no longer available. Review your cart and try again."
            : code === "connection_not_configured"
              ? "This store has not connected a product backend, so checkout is unavailable."
              : code === "tenant_backend_unavailable"
                ? "The store's product backend is temporarily unavailable. Try again later."
                : code === "rate_limited"
                  ? "Too many checkout attempts. Wait a few minutes and try again."
                  : "The order could not be placed. Please try again.",
        );
        return;
      }
      const order =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!order?.success) {
        setError("The server returned an invalid order confirmation.");
        return;
      }
      clear();
      router.push(
        `/${locale}/checkout/success?orderId=${encodeURIComponent(order.data.id)}`,
      );
    } catch {
      setError("Checkout could not reach the server. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">
          Your cart is empty
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Add active products to your cart to place an order.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
      <section className="space-y-4">
        {items.map((item) => (
          <article
            className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            key={item.id}
          >
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="text-sm text-slate-500">{item.slug}</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Qty
                <input
                  className="w-16 rounded-md border border-slate-300 px-2 py-1"
                  min={1}
                  type="number"
                  value={item.quantity}
                  disabled={checkingOut}
                  onChange={(event) =>
                    updateQuantity(item.id, Number(event.target.value) || 0)
                  }
                />
              </label>
              <p className="min-w-24 text-right text-sm font-medium text-slate-900">
                {formatCurrencyAmount(
                  item.quantity * item.price,
                  item.currency,
                  locale,
                )}
              </p>
              <button
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                onClick={() => removeItem(item.id)}
                disabled={checkingOut}
                type="button"
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </section>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-lg font-semibold text-slate-900">Order summary</h3>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span>
              {formatCurrencyAmount(
                subtotal,
                items[0]?.currency ?? "USD",
                locale,
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Shipping and tax</span>
            <span>Not calculated</span>
          </div>
          <div className="border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <div className="flex items-center justify-between">
              <span>Total</span>
              <span>
                {formatCurrencyAmount(
                  subtotal,
                  items[0]?.currency ?? "USD",
                  locale,
                )}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {!signedIn && (
          <p className="mt-4 text-sm text-slate-600">
            Sign in to place an order. Your cart will be saved while you sign
            in.
          </p>
        )}
        {signedIn ? (
          <button
            className="mt-6 w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={checkingOut}
            onClick={onCheckout}
            type="button"
          >
            {checkingOut ? "Placing order…" : "Place order"}
          </button>
        ) : (
          <Link
            className="mt-6 inline-flex w-full justify-center rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            href={`/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`}
          >
            Sign in to place order
          </Link>
        )}
      </aside>
    </div>
  );
}
