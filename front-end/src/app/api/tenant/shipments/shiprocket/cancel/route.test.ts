import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantPortalSession,
  getPlatformStore,
  getServerEnv,
  cancelShiprocketShipment,
  createTenantOrderAdapter,
} = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getServerEnv: vi.fn(),
  cancelShiprocketShipment: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/env", () => ({ getServerEnv }));
vi.mock("@/lib/server/shiprocket-shipments", () => ({
  cancelShiprocketShipment,
}));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function cancellationRequest() {
  return new Request(
    "http://store.localhost:3000/api/tenant/shipments/shiprocket/cancel",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderId }),
    },
  );
}

describe("POST /api/tenant/shipments/shiprocket/cancel", () => {
  afterEach(() => vi.clearAllMocks());

  it("marks an existing Shiprocket fulfillment cancelled and syncs it", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:write"],
    });
    getServerEnv.mockReturnValue({
      SHIPROCKET_API_EMAIL: "api@example.com",
      SHIPROCKET_API_PASSWORD: "secret",
      SHIPROCKET_PICKUP_LOCATION: "Primary",
    });
    const fulfillment = {
      carrier: "Delhivery",
      trackingNumber: "AWB123",
      trackingUrl: "https://shiprocket.co/tracking/AWB123",
    };
    const order = { id: orderId, tenantId, status: "Shipped", fulfillment };
    const cancelledFulfillment = { ...fulfillment, cancelled: true };
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      fulfillment: cancelledFulfillment,
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
      updateCustomerOrderStatus,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    cancelShiprocketShipment.mockResolvedValue(undefined);
    const updateOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      fulfillment: cancelledFulfillment,
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await POST(cancellationRequest());

    expect(response.status).toBe(200);
    expect(cancelShiprocketShipment).toHaveBeenCalledWith(
      expect.objectContaining({ awb: "AWB123" }),
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Shipped",
      fulfillment: cancelledFulfillment,
    });
  });

  it("returns success without calling the provider for an idempotent replay", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:write"],
    });
    getServerEnv.mockReturnValue({
      SHIPROCKET_API_EMAIL: "api@example.com",
      SHIPROCKET_API_PASSWORD: "secret",
      SHIPROCKET_PICKUP_LOCATION: "Primary",
    });
    const order = {
      id: orderId,
      tenantId,
      status: "Shipped",
      fulfillment: { trackingNumber: "AWB123", cancelled: true },
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
    });

    const response = await POST(cancellationRequest());

    expect(response.status).toBe(200);
    expect(cancelShiprocketShipment).not.toHaveBeenCalled();
  });
});
