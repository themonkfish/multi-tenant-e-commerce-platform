import { describe, expect, it } from "vitest";
import { summarizeTenantOrders } from "./tenant-order-report";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

function order(overrides: Partial<CustomerOrder>): CustomerOrder {
  return {
    id: "ORD-550e8400-e29b-41d4-a716-446655440001",
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    customerId: "550e8400-e29b-41d4-a716-446655440002",
    status: "Confirmed",
    createdAt: "2026-11-23T12:00:00.000Z",
    items: [],
    total: 100,
    currency: "USD",
    itemCount: 1,
    paymentMethod: "stripe",
    paymentStatus: "paid",
    ...overrides,
  } as CustomerOrder;
}

describe("summarizeTenantOrders", () => {
  it("summarizes gross sales and payment/fulfillment states", () => {
    const report = summarizeTenantOrders([
      order({ id: "ORD-1", total: 1250 }),
      order({
        id: "ORD-2",
        total: 750,
        paymentMethod: "cash_on_delivery",
        paymentStatus: "cod_due",
      }),
      order({ id: "ORD-3", total: 500, status: "Shipped" }),
      order({ id: "ORD-4", total: 400, status: "Delivered" }),
      order({ id: "ORD-5", total: 300, status: "Cancelled" }),
      order({ id: "ORD-6", total: 200, paymentStatus: "refunded" }),
    ]);

    expect(report).toEqual({
      orderCount: 6,
      grossSalesMinor: 3100,
      paidCount: 4,
      codDueCount: 1,
      refundedCount: 1,
      cancelledCount: 1,
      shippedCount: 1,
      deliveredCount: 1,
    });
  });

  it("returns zero values for no orders", () => {
    expect(summarizeTenantOrders([])).toEqual({
      orderCount: 0,
      grossSalesMinor: 0,
      paidCount: 0,
      codDueCount: 0,
      refundedCount: 0,
      cancelledCount: 0,
      shippedCount: 0,
      deliveredCount: 0,
    });
  });
});
