import { describe, expect, it } from "vitest";
import { summarizePlatformOrders } from "./platform-analytics-summary";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

function order(overrides: Partial<CustomerOrder>): CustomerOrder {
  return {
    id: "ORD-1",
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    customerId: "550e8400-e29b-41d4-a716-446655440001",
    status: "Confirmed",
    createdAt: "2026-11-19T10:00:00.000Z",
    items: [],
    total: 100,
    currency: "INR",
    itemCount: 1,
    paymentMethod: "stripe",
    paymentStatus: "paid",
    ...overrides,
  } as CustomerOrder;
}

describe("summarizePlatformOrders", () => {
  it("counts orders and groups gross totals by currency", () => {
    const summary = summarizePlatformOrders([
      order({ id: "ORD-1", total: 1250, currency: "INR" }),
      order({
        id: "ORD-2",
        total: 750,
        currency: "INR",
        paymentStatus: "cod_due",
        paymentMethod: "cash_on_delivery",
        deliveryAddress: {
          fullName: "Test Customer",
          line1: "1 Test Road",
          city: "Mumbai",
          state: "Maharashtra",
          postalCode: "400001",
          country: "IN",
          phone: "+919876543210",
        },
      }),
      order({ id: "ORD-3", total: 25, currency: "USD" }),
    ]);

    expect(summary).toMatchObject({
      orderCount: 3,
      paidOrderCount: 2,
      codDueCount: 1,
      totalsByCurrency: [
        ["INR", 2000],
        ["USD", 25],
      ],
    });
  });

  it("returns zero totals for no orders", () => {
    expect(summarizePlatformOrders([])).toEqual({
      orderCount: 0,
      paidOrderCount: 0,
      codDueCount: 0,
      totalsByCurrency: [],
    });
  });
});
