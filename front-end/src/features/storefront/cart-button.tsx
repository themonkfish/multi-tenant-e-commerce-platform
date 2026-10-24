"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProductOption } from "@/core/ports/data";
import type { ProductVariant } from "@/core/ports/data";
import {
  getCartItemKey,
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
  options = [],
  variants = [],
}: {
  item: CartItemInput;
  options?: ProductOption[];
  variants?: ProductVariant[];
}) {
  const addItem = useCartStore((state) => state.addItem);
  const cartItems = useCartStore((state) => state.items);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const ready = options.every((option) => selections[option.name]);
  const matchingVariant = variants.find(
    (variant) =>
      Object.entries(variant.selections).every(
        ([name, value]) => selections[name] === value,
      ) &&
      Object.keys(variant.selections).length === Object.keys(selections).length,
  );
  const selectedQuantity = cartItems.find(
    (candidate) =>
      getCartItemKey(candidate) ===
      getCartItemKey({ ...item, variantSelections: selections }),
  )?.quantity ?? 0;
  const outOfStock =
    matchingVariant !== undefined &&
    selectedQuantity >= matchingVariant.stock;

  return (
    <div className="space-y-3">
      {options.map((option) => (
        <label
          className="flex items-center justify-between gap-3 text-sm text-slate-700"
          key={option.name}
        >
          <span>{option.name}</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
            value={selections[option.name] ?? ""}
            onChange={(event) =>
              setSelections((current) => ({
                ...current,
                [option.name]: event.target.value,
              }))
            }
          >
            <option value="">Choose {option.name}</option>
            {option.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!ready || outOfStock}
        onClick={() =>
          addItem({
            ...item,
            ...(options.length ? { variantSelections: selections } : {}),
            ...(matchingVariant
              ? { availableStock: matchingVariant.stock }
              : {}),
          })
        }
        style={{ backgroundColor: "#111827" }}
        type="button"
      >
        {outOfStock ? "Out of stock" : "Add to cart"}
        <span className="ml-2 text-xs text-slate-200">{item.currency}</span>
      </button>
    </div>
  );
}
