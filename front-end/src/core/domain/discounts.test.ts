import { describe, expect, it } from "vitest";
import { TenantDiscountSchema } from "./host-portal";
import {
  calculateDiscountAmount,
  findTenantDiscount,
  validateTenantDiscount,
} from "./discounts";

describe("tenant discounts", () => {
  it("normalizes codes and validates optional campaign limits", () => {
    const discount = TenantDiscountSchema.parse({
      code: " save-10 ",
      type: "percentage",
      value: 10,
      minimumSubtotal: 1000,
      expiresAt: "2027-01-01T00:00:00.000Z",
      redemptionLimit: 20,
    });

    expect(discount.code).toBe("SAVE-10");
    expect(
      TenantDiscountSchema.safeParse({
        code: "SAVE-100",
        type: "percentage",
        value: 100,
      }).success,
    ).toBe(false);
    expect(
      TenantDiscountSchema.safeParse({
        code: "SAVE",
        type: "fixed_amount",
        value: 500,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("calculates percentage and fixed discounts without discounting shipping", () => {
    const percentage = TenantDiscountSchema.parse({
      code: "TEN",
      type: "percentage",
      value: 10,
    });
    const fixed = TenantDiscountSchema.parse({
      code: "FIVE",
      type: "fixed_amount",
      value: 500,
    });

    expect(calculateDiscountAmount(percentage, 2550)).toBe(255);
    expect(calculateDiscountAmount(fixed, 400)).toBe(399);
  });

  it("validates code, minimum subtotal, and expiry", () => {
    const discount = TenantDiscountSchema.parse({
      code: "MINIMUM",
      type: "fixed_amount",
      value: 300,
      minimumSubtotal: 1000,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });

    expect(findTenantDiscount([discount], " minimum ")).toEqual(discount);
    expect(validateTenantDiscount(undefined, 1000)).toBe(
      "discount_code_invalid",
    );
    expect(validateTenantDiscount(discount, 999)).toBe(
      "discount_minimum_not_met",
    );
    expect(
      validateTenantDiscount(discount, 1000, new Date("2026-12-01T00:00:00Z")),
    ).toBe("discount_expired");
    expect(
      validateTenantDiscount(discount, 1000, new Date("2026-11-01T00:00:00Z")),
    ).toBeNull();
  });
});
