import type { TenantStoreSettings } from "./host-portal";

export type TenantDiscount = TenantStoreSettings["discounts"][number];

export type DiscountValidationError =
  | "discount_code_invalid"
  | "discount_minimum_not_met"
  | "discount_expired"
  | "discount_limit_reached";

export function findTenantDiscount(
  discounts: TenantDiscount[],
  code: string,
): TenantDiscount | undefined {
  const normalized = code.trim().toUpperCase();
  return discounts.find((discount) => discount.code === normalized);
}

export function validateTenantDiscount(
  discount: TenantDiscount | undefined,
  subtotal: number,
  now = new Date(),
): DiscountValidationError | null {
  if (!discount) return "discount_code_invalid";
  if (
    discount.expiresAt !== undefined &&
    Date.parse(discount.expiresAt) <= now.getTime()
  ) {
    return "discount_expired";
  }
  if (
    discount.minimumSubtotal !== undefined &&
    subtotal < discount.minimumSubtotal
  ) {
    return "discount_minimum_not_met";
  }
  return null;
}

export function calculateDiscountAmount(
  discount: TenantDiscount,
  subtotal: number,
): number {
  const requested =
    discount.type === "percentage"
      ? Math.floor((subtotal * discount.value) / 100)
      : discount.value;
  return Math.min(requested, Math.max(0, subtotal - 1));
}
