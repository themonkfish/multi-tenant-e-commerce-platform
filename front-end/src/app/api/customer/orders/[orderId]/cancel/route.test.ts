import { afterEach, describe, expect, it, vi } from "vitest";

const { getCustomerSession, getPlatformStore, cancelCustomerCodOrder } =
  vi.hoisted(() => ({
    getCustomerSession: vi.fn(),
    getPlatformStore: vi.fn(),
    cancelCustomerCodOrder: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/cancel-customer-cod-order", () => ({
  cancelCustomerCodOrder,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function cancelRequest() {
  return new Request(
    `http://store.localhost:3000/api/customer/orders/${orderId}/cancel`,
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
      },
    },
  );
}

describe("POST /api/customer/orders/[orderId]/cancel", () => {
  afterEach(() => vi.clearAllMocks());

  it("rejects paid Stripe cancellation without invoking COD cleanup", async () => {
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    cancelCustomerCodOrder.mockResolvedValue({
      error: "order_not_cancellable",
    });

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "order_not_cancellable",
    });
  });

  it("allows an unpaid COD cancellation and returns the cancelled order", async () => {
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    cancelCustomerCodOrder.mockResolvedValue({
      order: { id: orderId, status: "Cancelled" },
      alreadyCancelled: false,
    });

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { id: orderId, status: "Cancelled" },
    });
  });
});
