import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantPortalSession,
  getPlatformStore,
  getServerEnv,
  cancelBlueDartShipment,
  createTenantOrderAdapter,
} = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getServerEnv: vi.fn(),
  cancelBlueDartShipment: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/env", () => ({ getServerEnv }));
vi.mock("@/lib/server/bluedart-shipments", () => ({
  cancelBlueDartShipment,
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
    "http://store.localhost:3000/api/tenant/shipments/bluedart/cancel",
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

describe("POST /api/tenant/shipments/bluedart/cancel", () => {
  afterEach(() => vi.clearAllMocks());

  function authorize() {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:write"],
    });
    getServerEnv.mockReturnValue({
      BLUEDART_API_BASE_URL: "https://api.example.com",
      BLUEDART_CUSTOMER_CODE: "CUSTOMER",
      BLUEDART_LOGIN_ID: "LOGIN",
      BLUEDART_LICENSE_KEY: "LICENSE",
    });
  }

  it("cancels and synchronizes BlueDart fulfillment", async () => {
    authorize();
    const fulfillment = {
      carrier: "BlueDart",
      trackingNumber: "BD123",
      trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
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
    });
    cancelBlueDartShipment.mockResolvedValue(undefined);
    const updateOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      fulfillment: cancelledFulfillment,
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await POST(cancellationRequest());

    expect(response.status).toBe(200);
    expect(cancelBlueDartShipment).toHaveBeenCalledWith(
      expect.objectContaining({ awb: "BD123" }),
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Shipped",
      fulfillment: cancelledFulfillment,
    });
  });

  it("is replay-safe once cancelled", async () => {
    authorize();
    const order = {
      id: orderId,
      tenantId,
      status: "Shipped",
      fulfillment: {
        carrier: "BlueDart",
        trackingNumber: "BD123",
        cancelled: true,
      },
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
    });
    const response = await POST(cancellationRequest());
    expect(response.status).toBe(200);
    expect(cancelBlueDartShipment).not.toHaveBeenCalled();
  });

  it("rejects missing fulfillment and provider failures", async () => {
    authorize();
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        { id: orderId, tenantId, status: "Processing" },
      ]),
    });
    const missingResponse = await POST(cancellationRequest());
    expect(missingResponse.status).toBe(409);

    const fulfillment = {
      carrier: "BlueDart",
      trackingNumber: "BD123",
      trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        { id: orderId, tenantId, status: "Shipped", fulfillment },
      ]),
    });
    cancelBlueDartShipment.mockRejectedValue(
      new Error("bluedart_cancellation_failed"),
    );
    const providerResponse = await POST(cancellationRequest());
    expect(providerResponse.status).toBe(502);
  });
});
