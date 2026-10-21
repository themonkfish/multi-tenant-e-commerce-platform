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
};

export type CartItemInput = {
  id: string;
  slug: string;
  title: string;
  price: number;
  currency: string;
};

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
        const existing = get().items.find((candidate) => candidate.id === item.id);
        set({
          items: existing
            ? get().items.map((candidate) =>
                candidate.id === item.id
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
      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          set({
            items: get().items.filter((candidate) => candidate.id !== id),
          });
          return;
        }

        set({
          items: get().items.map((candidate) =>
            candidate.id === id ? { ...candidate, quantity } : candidate,
          ),
        });
      },
      removeItem: (id) => {
        set({
          items: get().items.filter((candidate) => candidate.id !== id),
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
