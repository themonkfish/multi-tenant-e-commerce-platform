"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  id: string;
  slug: string;
  title: string;
  price: number;
  currency: string;
  quantity: number;
  variantSelections?: Record<string, string>;
  availableStock?: number;
};

export type CartItemInput = {
  id: string;
  slug: string;
  title: string;
  price: number;
  currency: string;
  variantSelections?: Record<string, string>;
  availableStock?: number;
};

export function getCartItemKey(item: CartItemInput | CartItem): string {
  const selections = item.variantSelections
    ? Object.entries(item.variantSelections).sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];
  return `${item.id}:${JSON.stringify(selections)}`;
}

type CartState = {
  items: CartItem[];
  addItem: (item: CartItemInput) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const key = getCartItemKey(item);
        const existing = get().items.find(
          (candidate) => getCartItemKey(candidate) === key,
        );
        if (
          item.availableStock !== undefined &&
          (existing?.quantity ?? 0) >= item.availableStock
        ) {
          return;
        }
        set({
          items: existing
            ? get().items.map((candidate) =>
                getCartItemKey(candidate) === key
                  ? { ...candidate, quantity: candidate.quantity + 1 }
                  : candidate,
              )
            : [
                ...get().items,
                {
                  ...item,
                  quantity: 1,
                },
              ],
        });
      },
      updateQuantity: (key, quantity) => {
        if (quantity <= 0) {
          set({
            items: get().items.filter(
              (candidate) => getCartItemKey(candidate) !== key,
            ),
          });
          return;
        }

        set({
          items: get().items.map((candidate) =>
            getCartItemKey(candidate) === key
              ? { ...candidate, quantity }
              : candidate,
          ),
        });
      },
      removeItem: (key) => {
        set({
          items: get().items.filter(
            (candidate) => getCartItemKey(candidate) !== key,
          ),
        });
      },
      clear: () => set({ items: [] }),
    }),
    {
      name: "tenant-storefront-cart",
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
