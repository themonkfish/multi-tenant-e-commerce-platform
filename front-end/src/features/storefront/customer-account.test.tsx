import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { StorefrontCustomerAccount } from "./customer-account";

const order: CustomerOrder = {
  id: "ORD-550e8400-e29b-41d4-a716-446655440001",
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
  customerId: "550e8400-e29b-41d4-a716-446655440002",
  status: "Confirmed",
  createdAt: "2026-10-22T12:00:00.000Z",
  items: [
    {
      productId: "product-1",
      title: "Canvas Bag",
      slug: "canvas-bag",
      quantity: 2,
      unitPrice: 1250,
      currency: "USD",
    },
  ],
  subtotal: 2500,
  discountAmount: 0,
  taxRateBasisPoints: 800,
  taxAmount: 200,
  shippingAmount: 0,
  total: 2700,
  currency: "USD",
  itemCount: 2,
  paymentMethod: "stripe",
  paymentStatus: "paid",
  paymentAttempt: 1,
  backendSyncStatus: "synced",
};

describe("StorefrontCustomerAccount", () => {
  it("shows tax in order history even when the order has no discount", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StorefrontCustomerAccount
          locale="en"
          customer={{ email: "customer@example.test", orders: [order] }}
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain("Includes $2.00 tax");
    expect(markup).not.toContain("Discount");
  });
});
