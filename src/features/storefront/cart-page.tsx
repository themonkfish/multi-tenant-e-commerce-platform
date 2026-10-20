"use client";

import { useMemo, useState } from "react";
import { useCartStore } from "@/features/storefront/cart-store";

export function StorefrontCartPage({ locale }: { locale: string }) {
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clear = useCartStore((state) => state.clear);
  const [checkedOut, setCheckedOut] = useState(false);

  const subtotal = useMemo(
    () =>
      items.reduce(
        (total, item) => total + item.quantity * item.price,
        0,
      ),
    [items],
  );

  async function onCheckout() {
    setCheckedOut(true);
    clear();
  }

  if (items.length === 0 && !checkedOut) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">Your cart is empty</h2>
        <p className="mt-2 text-sm text-slate-600">
          Add a few products to preview the storefront checkout flow.
        </p>
      </section>
    );
  }

  if (checkedOut) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <h2 className="text-2xl font-semibold text-emerald-900">
          Your order is placed
        </h2>
        <p className="mt-2 text-sm text-emerald-800">
          This demo checkout is complete. The cart has been cleared for a new shopping session.
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
              <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
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
                  onChange={(event) =>
                    updateQuantity(item.id, Number(event.target.value) || 0)
                  }
                />
              </label>
              <p className="min-w-24 text-right text-sm font-medium text-slate-900">
                {item.quantity * item.price} {item.currency}
              </p>
              <button
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                onClick={() => removeItem(item.id)}
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
            <span>{subtotal} {items[0]?.currency ?? "USD"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Shipping</span>
            <span>0.00</span>
          </div>
          <div className="border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <div className="flex items-center justify-between">
              <span>Total</span>
              <span>{subtotal} {items[0]?.currency ?? "USD"}</span>
            </div>
          </div>
        </div>

        <button
          className="mt-6 w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
          onClick={() => void onCheckout()}
          type="button"
        >
          Proceed to checkout
        </button>
      </aside>
    </div>
  );
}
