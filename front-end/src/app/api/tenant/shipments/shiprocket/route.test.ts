import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantPortalSession,
  getPlatformStore,
  getServerEnv,
  createShiprocketShipment,
  createTenantOrderAdapter,
} = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getServerEnv: vi.fn(),
  createShiprocketShipment: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/env", () => ({ getServerEnv }));
vi.mock("@/lib/server/shiprocket-shipments", () => ({
  createShiprocketShipment,
}));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function shipmentRequest() {
  return new Request(
    "http://store.localhost:3000/api/tenant/shipments/shiprocket",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        orderId,
        package: {
          weightKg: 1,
          lengthCm: 20,
          breadthCm: 15,
          heightCm: 10,
        },
      }),
    },
  );
}

describe("POST /api/tenant/shipments/shiprocket", () => {
  afterEach(() => vi.clearAllMocks());

  it("records the platform shipment before retryable Tenant backend sync", async () => {
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
      customerId: "550e8400-e29b-41d4-a716-446655440030",
      status: "Processing",
      deliveryAddress: {
        fullName: "Test Customer",
        line1: "1 Test Road",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "IN",
        phone: "+919876543210",
      },
    };
    const shipment = {
      carrier: "Delhivery",
      trackingNumber: "AWB123",
      trackingUrl: "https://shiprocket.co/tracking/AWB123",
    };
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      status: "Shipped",
      fulfillment: shipment,
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
      updateCustomerOrderStatus,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    createShiprocketShipment.mockResolvedValue(shipment);
    createTenantOrderAdapter.mockResolvedValue({
      updateOrderStatus: vi.fn().mockResolvedValue({
        ...order,
        status: "Shipped",
        fulfillment: shipment,
      }),
    });

    const response = await POST(shipmentRequest());

    expect(response.status).toBe(200);
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Shipped",
      fulfillment: shipment,
    });
  });

  it("retries only Tenant backend sync when the platform already has the AWB", async () => {
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
    const shipment = {
      carrier: "Delhivery",
      trackingNumber: "AWB123",
      trackingUrl: "https://shiprocket.co/tracking/AWB123",
    };
    const order = {
      id: orderId,
      tenantId,
      customerId: "550e8400-e29b-41d4-a716-446655440030",
      status: "Shipped",
      fulfillment: shipment,
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
    });
    const updateOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      status: "Shipped",
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await POST(shipmentRequest());

    expect(response.status).toBe(200);
    expect(createShiprocketShipment).not.toHaveBeenCalled();
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Shipped",
      shipment,
    );
  });
});
