import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

const { createSession } = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: createSession } };
  },
}));

import { createStripeCheckoutSession } from "./stripe-payments";

const order: CustomerOrder = {
  id: "order-123",
  tenantId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  status: "Confirmed",
  createdAt: "2026-10-24T00:00:00.000Z",
  items: [
    {
      productId: "product-1",
      title: "Canvas bag",
      slug: "canvas-bag",
      quantity: 2,
      unitPrice: 2500,
      currency: "INR",
    },
  ],
  subtotal: 5000,
  shippingAmount: 200,
  total: 5200,
  currency: "INR",
  itemCount: 2,
  paymentMethod: "stripe",
  paymentStatus: "pending",
  paymentAttempt: 1,
  backendSyncStatus: "not_configured",
};

describe("Stripe Checkout session creation", () => {
  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ id: "cs_test_checkout" });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_checkout_secret");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_webhook_secret");
  });

  it("adds shipping as a separate line item and matches the saved order total", async () => {
    await createStripeCheckoutSession({
      order,
      attempt: 1,
      successUrl: "https://shop.example/checkout/success",
      cancelUrl: "https://shop.example/cart",
    });

    const [session, options] = createSession.mock.calls[0];
    expect(session.line_items).toHaveLength(2);
    expect(session.line_items[1]).toMatchObject({
      quantity: 1,
      price_data: {
        currency: "inr",
        unit_amount: 200,
        product_data: { name: "Shipping" },
      },
    });
    const sessionTotal = session.line_items.reduce(
      (
        total: number,
        item: { quantity: number; price_data: { unit_amount: number } },
      ) => total + item.quantity * item.price_data.unit_amount,
      0,
    );
    expect(sessionTotal).toBe(order.total);
    expect(options).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111-order-123-1",
    });
  });

  it("omits a shipping line item when shipping is free", async () => {
    await createStripeCheckoutSession({
      order: { ...order, shippingAmount: 0, total: 5000 },
      attempt: 1,
      successUrl: "https://shop.example/checkout/success",
      cancelUrl: "https://shop.example/cart",
    });

    const [session] = createSession.mock.calls[0];
    expect(session.line_items).toHaveLength(1);
    expect(session.line_items[0].price_data.unit_amount).toBe(2500);
  });

  it("applies the discount to merchandise before adding shipping", async () => {
    const discountedOrder: CustomerOrder = {
      ...order,
      discountCode: "SAVE10",
      discountAmount: 500,
      total: 4700,
    };
    await createStripeCheckoutSession({
      order: discountedOrder,
      attempt: 1,
      successUrl: "https://shop.example/checkout/success",
      cancelUrl: "https://shop.example/cart",
    });

    const [session] = createSession.mock.calls[0];
    expect(session.line_items).toHaveLength(2);
    expect(session.line_items[0]).toMatchObject({
      quantity: 1,
      price_data: {
        currency: "inr",
        unit_amount: 4500,
        product_data: {
          name: "Items after SAVE10 discount",
        },
      },
    });
    expect(session.metadata).toMatchObject({
      discountCode: "SAVE10",
      discountAmount: "500",
    });
    expect(
      session.line_items.reduce(
        (
          total: number,
          item: { quantity: number; price_data: { unit_amount: number } },
        ) => total + item.quantity * item.price_data.unit_amount,
        0,
      ),
    ).toBe(discountedOrder.total);
  });

  it("rejects order totals that do not match item, discount, and shipping amounts", async () => {
    await expect(
      createStripeCheckoutSession({
        order: { ...order, total: 5199 },
        attempt: 1,
        successUrl: "https://shop.example/checkout/success",
        cancelUrl: "https://shop.example/cart",
      }),
    ).rejects.toThrow("Stripe Checkout order amounts do not match");
    expect(createSession).not.toHaveBeenCalled();
  });
});
