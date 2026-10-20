"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem } from "@/features/storefront/cart-store";

export type OrderSummary = {
  id: string;
  createdAt: string;
  status: "Confirmed" | "Processing" | "Shipped";
  items: CartItem[];
  subtotal: number;
  total: number;
  currency: string;
  itemCount: number;
};

type OrderState = {
  orders: OrderSummary[];
  placeOrder: (items: CartItem[]) => OrderSummary | null;
  clear: () => void;
};

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      orders: [],
      placeOrder: (items) => {
        if (items.length === 0) {
          return null;
        }

        const currency = items[0]?.currency ?? "USD";
        const subtotal = items.reduce(
          (total, item) => total + item.quantity * item.price,
          0,
        );
        const order: OrderSummary = {
          id: `ORD-${Date.now().toString().slice(-6)}`,
          createdAt: new Date().toISOString(),
          status: "Confirmed",
          items: items.map((item) => ({ ...item })),
          subtotal,
          total: subtotal,
          currency,
          itemCount: items.reduce((total, item) => total + item.quantity, 0),
        };

        set({
          orders: [order, ...get().orders].slice(0, 8),
        });

        return order;
      },
      clear: () => set({ orders: [] }),
    }),
    {
      name: "tenant-storefront-orders",
      partialize: (state) => ({ orders: state.orders.slice(0, 8) }),
    },
  ),
);
