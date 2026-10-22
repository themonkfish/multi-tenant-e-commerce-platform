import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomerSession,
  getPlatformStore,
  isLocalDemoCheckoutEnabled,
  syncCustomerOrderToTenant,
} = vi.hoisted(() => ({
  getCustomerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  isLocalDemoCheckoutEnabled: vi.fn(),
  syncCustomerOrderToTenant: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/demo-checkout", () => ({
  isLocalDemoCheckoutEnabled,
  isDemoCheckoutSession: (sessionId: string) => sessionId.startsWith("demo_"),
}));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const sessionId = "demo_1_test";
const order = {
  id: orderId,
  tenantId,
  customerId,
  status: "Confirmed",
  createdAt: "2026-10-22T12:00:00.000Z",
  items: [],
  total: 2500,
  currency: "USD",
  itemCount: 1,
  paymentStatus: "pending",
  paymentAttempt: 1,
  paymentSessionId: sessionId,
  backendSyncStatus: "not_configured",
};

function paymentRequest(result: "paid" | "failed") {
  return new Request(
    `http://store.localhost:3000/api/customer/orders/${orderId}/demo-payment`,
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ result }),
    },
  );
}

function setAuthenticatedSession() {
  isLocalDemoCheckoutEnabled.mockReturnValue(true);
  getCustomerSession.mockResolvedValue({
    userId: customerId,
    role: "customer",
    scope: { kind: "tenant", id: tenantId, hostId: "host-id" },
    permissions: ["customer:orders:read"],
  });
}

describe("POST /api/customer/orders/[orderId]/demo-payment", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires the local demo checkout configuration", async () => {
    isLocalDemoCheckoutEnabled.mockReturnValue(false);

    const response = await POST(paymentRequest("paid"), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(404);
    expect(getCustomerSession).not.toHaveBeenCalled();
  });

  it("confirms payment before syncing the order to the Tenant backend", async () => {
    setAuthenticatedSession();
    const updateCustomerOrderPayment = vi.fn().mockResolvedValue({
      ...order,
      paymentStatus: "paid",
    });
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment,
    };
    getPlatformStore.mockReturnValue(store);
    syncCustomerOrderToTenant.mockResolvedValue({
      ...order,
      paymentStatus: "paid",
      backendSyncStatus: "synced",
    });

    const response = await POST(paymentRequest("paid"), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(updateCustomerOrderPayment).toHaveBeenCalledWith({
      tenantId,
      customerId,
      orderId,
      sessionId,
      status: "paid",
    });
    expect(syncCustomerOrderToTenant).toHaveBeenCalledWith({
      store,
      tenantId,
      hostId: "host-id",
      order: expect.objectContaining({ paymentStatus: "paid" }),
    });
  });

  it("records failed demo payments without syncing orders", async () => {
    setAuthenticatedSession();
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment: vi.fn().mockResolvedValue({
        ...order,
        paymentStatus: "failed",
      }),
    };
    getPlatformStore.mockReturnValue(store);

    const response = await POST(paymentRequest("failed"), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(store.updateCustomerOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", sessionId }),
    );
    expect(syncCustomerOrderToTenant).not.toHaveBeenCalled();
  });
});
