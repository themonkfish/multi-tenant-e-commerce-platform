import { describe, expect, it } from "vitest";
import {
  createDefaultTenantStoreSettings,
  TenantStoreSettingsSchema,
} from "./host-portal";
import { CustomerOrderSchema } from "./tenant-identities";
import { calculateTaxAmount } from "./tax";

describe("calculateTaxAmount", () => {
  it("calculates tax in minor units and rounds to the nearest unit", () => {
    expect(calculateTaxAmount(2250, 825)).toBe(186);
    expect(calculateTaxAmount(100, 125)).toBe(1);
    expect(calculateTaxAmount(100, 0)).toBe(0);
  });

  it("rejects negative, fractional, or out-of-range inputs", () => {
    expect(() => calculateTaxAmount(-1, 100)).toThrow(
      "Tax amount or rate is out of range",
    );
    expect(() => calculateTaxAmount(100, 10_001)).toThrow(
      "Tax amount or rate is out of range",
    );
    expect(() => calculateTaxAmount(10.5, 100)).toThrow(
      "Tax amount or rate is out of range",
    );
  });

  it("defaults tenant tax off and validates configured basis-point rates", () => {
    const defaults = createDefaultTenantStoreSettings("Shop");
    expect(defaults.tax).toEqual({ rateBasisPoints: 0 });
    expect(
      TenantStoreSettingsSchema.parse({
        ...defaults,
        tax: { rateBasisPoints: 825 },
      }).tax.rateBasisPoints,
    ).toBe(825);
    expect(
      TenantStoreSettingsSchema.safeParse({
        ...defaults,
        tax: { rateBasisPoints: 10_001 },
      }).success,
    ).toBe(false);
  });

  it("validates the tax snapshot and total against discounted merchandise", () => {
    const order = {
      id: "ORD-123",
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      customerId: "550e8400-e29b-41d4-a716-446655440002",
      status: "Confirmed",
      createdAt: "2026-10-24T00:00:00.000Z",
      items: [
        {
          productId: "product-1",
          title: "Bag",
          slug: "bag",
          quantity: 2,
          unitPrice: 100,
          currency: "USD",
        },
      ],
      subtotal: 200,
      discountCode: "SAVE",
      discountAmount: 50,
      taxRateBasisPoints: 825,
      taxAmount: 12,
      shippingAmount: 10,
      total: 172,
      currency: "USD",
      itemCount: 2,
    };

    expect(CustomerOrderSchema.safeParse(order).success).toBe(true);
    expect(
      CustomerOrderSchema.safeParse({ ...order, taxAmount: 13 }).success,
    ).toBe(false);
    expect(
      CustomerOrderSchema.safeParse({ ...order, total: 171 }).success,
    ).toBe(false);
  });
});
