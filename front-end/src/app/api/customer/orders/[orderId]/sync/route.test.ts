import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomerSession,
  getPlatformStore,
  syncCustomerOrderToTenant,
  canAccessPermission,
  isSameOrigin,
  createRateLimitKey,
} = vi.hoisted(() => ({
  getCustomerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  syncCustomerOrderToTenant: vi.fn(),
  canAccessPermission: vi.fn(),
  isSameOrigin: vi.fn(),
  createRateLimitKey: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant,
}));
vi.mock("@/core/tenancy/scope", () => ({ canAccessPermission }));
vi.mock("@/lib/server/http", () => ({ isSameOrigin, createRateLimitKey }));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440020";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function request() {
  return new Request(
    `https://store.example.com/api/customer/orders/${orderId}/sync`,
    {
      method: "POST",
      headers: {
        origin: "https://store.example.com",
      },
    },
  );
}

function setupSession() {
  getCustomerSession.mockResolvedValue({
    userId: customerId,
    role: "customer",
    scope: { kind: "tenant", id: tenantId, hostId },
    permissions: ["customer:orders:read"],
  });
  canAccessPermission.mockReturnValue(true);
  isSameOrigin.mockReturnValue(true);
  createRateLimitKey.mockReturnValue("customer-order-sync-rate-key");
}

describe("POST /api/customer/orders/[orderId]/sync", () => {
  afterEach(() => vi.clearAllMocks());

  it("retries Tenant delivery for a paid order", async () => {
    setupSession();
    const order = {
      id: orderId,
      tenantId,
      customerId,
      paymentMethod: "stripe",
      paymentStatus: "paid",
      backendSyncStatus: "failed",
    };
    const synced = { ...order, backendSyncStatus: "synced" };
    getPlatformStore.mockReturnValue({
      listCustomerOrders: vi.fn().mockResolvedValue([order]),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    syncCustomerOrderToTenant.mockResolvedValue(synced);

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ order: synced });
  });

  it("retries Tenant delivery for an unpaid COD order", async () => {
    setupSession();
    const order = {
      id: orderId,
      tenantId,
      customerId,
      paymentMethod: "cash_on_delivery",
      paymentStatus: "cod_due",
      backendSyncStatus: "failed",
    };
    const synced = { ...order, backendSyncStatus: "synced" };
    getPlatformStore.mockReturnValue({
      listCustomerOrders: vi.fn().mockResolvedValue([order]),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    syncCustomerOrderToTenant.mockResolvedValue(synced);

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(syncCustomerOrderToTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, hostId, order }),
    );
  });

  it("rejects sync retry while payment is pending", async () => {
    setupSession();
    getPlatformStore.mockReturnValue({
      listCustomerOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          tenantId,
          customerId,
          paymentMethod: "stripe",
          paymentStatus: "pending",
          backendSyncStatus: "failed",
        },
      ]),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "payment_required" });
  });

  it("returns rate_limited before retrying delivery", async () => {
    setupSession();
    getPlatformStore.mockReturnValue({
      listCustomerOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          tenantId,
          customerId,
          paymentMethod: "stripe",
          paymentStatus: "paid",
          backendSyncStatus: "failed",
        },
      ]),
      consumeRateLimit: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(syncCustomerOrderToTenant).not.toHaveBeenCalled();
  });
});
