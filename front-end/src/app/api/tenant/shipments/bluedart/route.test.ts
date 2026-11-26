import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantPortalSession,
  getPlatformStore,
  getServerEnv,
  createBlueDartShipment,
  createTenantOrderAdapter,
} = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getServerEnv: vi.fn(),
  createBlueDartShipment: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/env", () => ({ getServerEnv }));
vi.mock("@/lib/server/bluedart-shipments", () => ({
  createBlueDartShipment,
}));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function shipmentRequest(body: unknown = {
  orderId,
  package: {
    weightKg: 1,
    lengthCm: 20,
    breadthCm: 15,
    heightCm: 10,
  },
}) {
  return new Request(
    "http://store.localhost:3000/api/tenant/shipments/bluedart",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function setAuthorizedSession() {
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

describe("POST /api/tenant/shipments/bluedart", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires orders:write permission", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read"],
    });
    const response = await POST(shipmentRequest());
    expect(response.status).toBe(403);
  });

  it("returns a conflict when BlueDart credentials are incomplete", async () => {
    setAuthorizedSession();
    getServerEnv.mockReturnValue({
      BLUEDART_API_BASE_URL: "https://api.example.com",
    });
    const response = await POST(shipmentRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "bluedart_credentials_required",
    });
  });

  it("rejects invalid package input", async () => {
    setAuthorizedSession();
    const response = await POST(
      shipmentRequest({
        orderId,
        package: {
          weightKg: 0,
          lengthCm: 20,
          breadthCm: 15,
          heightCm: 10,
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("creates and synchronizes a BlueDart shipment", async () => {
    setAuthorizedSession();
    const order = {
      id: orderId,
      tenantId,
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
      carrier: "BlueDart",
      trackingNumber: "BD123",
      trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
      updateCustomerOrderStatus: vi.fn().mockResolvedValue({
        ...order,
        status: "Shipped",
        fulfillment: shipment,
      }),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    createBlueDartShipment.mockResolvedValue(shipment);
    const updateOrderStatus = vi.fn().mockResolvedValue({
      ...order,
      status: "Shipped",
      fulfillment: shipment,
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await POST(shipmentRequest());

    expect(response.status).toBe(200);
    expect(createBlueDartShipment).toHaveBeenCalled();
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Shipped",
      shipment,
    );
  });

  it("rejects duplicate shipment creation and provider sync failures", async () => {
    setAuthorizedSession();
    const order = {
      id: orderId,
      tenantId,
      status: "Shipped",
      fulfillment: {
        carrier: "BlueDart",
        trackingNumber: "BD123",
        trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
      },
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
    });

    const response = await POST(shipmentRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "invalid_status_transition",
    });
  });

  it("returns provider and Tenant backend failures as bad gateways", async () => {
    setAuthorizedSession();
    const order = {
      id: orderId,
      tenantId,
      status: "Processing",
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
      updateCustomerOrderStatus: vi.fn().mockResolvedValue(order),
    });
    createBlueDartShipment.mockRejectedValue(
      new Error("bluedart_create_failed"),
    );

    const providerResponse = await POST(shipmentRequest());
    expect(providerResponse.status).toBe(502);
    expect(await providerResponse.json()).toEqual({
      error: "bluedart_create_failed",
    });

    createBlueDartShipment.mockResolvedValue({
      carrier: "BlueDart",
      trackingNumber: "BD123",
      trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
    });
    createTenantOrderAdapter.mockRejectedValue(
      new Error("Tenant backend unavailable"),
    );
    const syncResponse = await POST(shipmentRequest());
    expect(syncResponse.status).toBe(502);
  });
});
