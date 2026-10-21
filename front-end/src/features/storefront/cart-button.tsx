"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  useCartStore,
  type CartItemInput,
} from "@/features/storefront/cart-store";

export function StorefrontCartButton({ locale }: { locale: string }) {
  const items = useCartStore((state) => state.items);
  const quantity = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );

  return (
    <Link
      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
      href={`/${locale}/cart`}
    >
      Cart
      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
        {quantity}
      </span>
    </Link>
  );
}

export function StorefrontAddToCartButton({
  item,
  locale,
}: {
  item: CartItemInput;
  locale: string;
}) {
  const addItem = useCartStore((state) => state.addItem);

  return (
    <button
      className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-white transition hover:opacity-95"
      onClick={() => addItem(item)}
      style={{ backgroundColor: "#111827" }}
      type="button"
    >
      Add to cart
      <span className="ml-2 text-xs text-slate-200">{item.currency}</span>
    </button>
  );
}
