import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantPortalSession, getPlatformStore, createTenantOrderAdapter } =
  vi.hoisted(() => ({
    getTenantPortalSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createTenantOrderAdapter: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));

import { PATCH } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const customerId = "550e8400-e29b-41d4-a716-446655440002";

describe("PATCH /api/tenant/orders recovery", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retries an idempotent backend status after platform history reconciliation fails", async () => {
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed" as "Confirmed" | "Processing" | "Shipped",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [
        {
          productId: "product-1",
          title: "Canvas Bag",
          slug: "canvas-bag",
          quantity: 1,
          unitPrice: 2500,
          currency: "USD",
        },
      ],
      total: 2500,
      currency: "USD",
      itemCount: 1,
    };
    const updateOrderStatus = vi.fn(
      async (_id: string, status: typeof order.status) => {
        order.status = status;
        return { ...order };
      },
    );
    const updateCustomerOrderStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary platform store failure"))
      .mockResolvedValueOnce({
        ...order,
        backendSyncStatus: "synced",
      });
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateCustomerOrderStatus,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    };

    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue(store);
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const sendUpdate = () =>
      PATCH(
        new Request("http://store.localhost:3000/api/tenant/orders", {
          method: "PATCH",
          headers: {
            host: "store.localhost:3000",
            origin: "http://store.localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({ orderId, status: "Processing" }),
        }),
      );

    const firstResponse = await sendUpdate();
    expect(firstResponse.status).toBe(502);
    expect(order.status).toBe("Processing");

    const retryResponse = await sendUpdate();
    expect(retryResponse.status).toBe(200);
    expect(await retryResponse.json()).toMatchObject({
      order: { id: orderId, status: "Processing" },
    });
    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(updateCustomerOrderStatus).toHaveBeenCalledTimes(2);
    expect(store.appendAuditEvent).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTTPS shipment tracking URLs before calling the backend", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    const consumeRateLimit = vi.fn().mockResolvedValue(true);
    getPlatformStore.mockReturnValue({ consumeRateLimit });
    createTenantOrderAdapter.mockResolvedValue({
      updateOrderStatus: vi.fn(),
    });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          status: "Shipped",
          fulfillment: {
            trackingNumber: "TRACK-123",
            trackingUrl: "http://tracking.example.com/TRACK-123",
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });

  it("rejects shipment details unless the order is marked shipped", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    createTenantOrderAdapter.mockResolvedValue({
      updateOrderStatus: vi.fn(),
    });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          status: "Processing",
          fulfillment: { trackingNumber: "TRACK-123" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });

  it("persists shipment details in the tenant order snapshot and audits the change", async () => {
    const fulfillment = {
      carrier: "Parcel service",
      trackingNumber: "TRACK-123",
      trackingUrl: "https://tracking.example.com/TRACK-123",
    };
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Shipped",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [],
      total: 0,
      currency: "USD",
      itemCount: 1,
      fulfillment,
    };
    const updateOrderStatus = vi.fn().mockResolvedValue(order);
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue(order);
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateCustomerOrderStatus,
      appendAuditEvent,
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          status: "Shipped",
          fulfillment,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Shipped",
      fulfillment,
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Shipped",
      fulfillment,
    });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.order.fulfillment_updated",
        resourceId: orderId,
      }),
    );
    expect(await response.json()).toMatchObject({ order: { fulfillment } });
  });
});
