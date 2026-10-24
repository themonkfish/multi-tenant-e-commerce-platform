import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantPortalSession, getPlatformStore } = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));

import { GET, PATCH } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const operatorId = "550e8400-e29b-41d4-a716-446655440020";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function tenantSession(permissions: string[]) {
  return {
    userId: operatorId,
    role: "tenant_owner",
    scope: { kind: "tenant", id: tenantId, hostId },
    permissions,
  };
}

function sameOriginRequest(path: string, body?: unknown) {
  return new Request(`http://store.localhost:3000${path}`, {
    method: body === undefined ? "GET" : "PATCH",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/tenant/cash-on-delivery", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists only tenant-scoped pending cash orders for readers", async () => {
    const data = [
      {
        id: orderId,
        tenantId,
        customerId: "550e8400-e29b-41d4-a716-446655440030",
        status: "Confirmed",
        createdAt: "2026-10-22T12:00:00.000Z",
        items: [],
        total: 1500,
        currency: "INR",
        itemCount: 1,
        paymentMethod: "cash_on_delivery",
        paymentStatus: "cod_due",
        paymentAttempt: 0,
        deliveryAddress: {
          fullName: "Test Customer",
          line1: "1 Market Road",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
          country: "IN",
          phone: "+919876543210",
        },
      },
    ];
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantCashOnDeliveryOrders: vi.fn().mockResolvedValue({
        data,
        meta: { page: 1, limit: 20, total: 1 },
      }),
    };
    getTenantPortalSession.mockResolvedValue(tenantSession(["orders:read"]));
    getPlatformStore.mockReturnValue(store);

    const response = await GET(
      sameOriginRequest("/api/tenant/cash-on-delivery?page=1&limit=20"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: orderId, paymentStatus: "cod_due" }],
      meta: { total: 1 },
    });
    expect(store.listTenantCashOnDeliveryOrders).toHaveBeenCalledWith({
      tenantId,
      page: 1,
      limit: 20,
    });
  });

  it("requires write permission and atomically confirms cash collection", async () => {
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      markCustomerOrderCashOnDeliveryCollected: vi.fn().mockResolvedValue({
        id: orderId,
        tenantId,
        customerId: "550e8400-e29b-41d4-a716-446655440030",
        status: "Confirmed",
        createdAt: "2026-10-22T12:00:00.000Z",
        items: [],
        total: 1500,
        currency: "INR",
        itemCount: 1,
        paymentMethod: "cash_on_delivery",
        paymentStatus: "paid",
        paymentAttempt: 0,
        deliveryAddress: {
          fullName: "Test Customer",
          line1: "1 Market Road",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
          country: "IN",
          phone: "+919876543210",
        },
      }),
    };
    getTenantPortalSession.mockResolvedValue(
      tenantSession(["orders:read", "orders:write"]),
    );
    getPlatformStore.mockReturnValue(store);

    const response = await PATCH(
      sameOriginRequest("/api/tenant/cash-on-delivery", { orderId }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { id: orderId, paymentStatus: "paid" },
    });
    expect(store.markCustomerOrderCashOnDeliveryCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        orderId,
        auditEvent: expect.objectContaining({
          actorId: operatorId,
          action: "tenant.order.cash_on_delivery_collected",
        }),
      }),
    );
  });
});
