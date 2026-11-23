import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantPortalSession,
  getPlatformStore,
  createTenantOrderAdapter,
  cancelCustomerCodOrder,
} = vi.hoisted(() => ({
  getTenantPortalSession: vi.fn(),
  getPlatformStore: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
  cancelCustomerCodOrder: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));
vi.mock("@/lib/server/cancel-customer-cod-order", () => ({
  cancelCustomerCodOrder,
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

  it("requires write permission before COD cancellation", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read"],
    });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orderId, status: "Cancelled" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("hands COD cancellation to the cleanup helper and returns the cancelled order", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          tenantId,
          customerId,
          status: "Confirmed",
          paymentMethod: "cash_on_delivery",
          paymentStatus: "cod_due",
        },
      ]),
    });
    cancelCustomerCodOrder.mockResolvedValue({
      order: { id: orderId, tenantId, customerId, status: "Cancelled" },
      alreadyCancelled: false,
    });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orderId, status: "Cancelled" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { id: orderId, status: "Cancelled" },
    });
    expect(cancelCustomerCodOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        hostId,
        customerId,
        orderId,
        auditAction: "tenant.order.cod_cancelled",
      }),
    );
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

  it("auto-generates an HTTPS tracking URL for a supported carrier", async () => {
    const fulfillment = {
      carrier: "FedEx",
      trackingNumber: "TRACK 123",
    };
    const resolvedFulfillment = {
      ...fulfillment,
      trackingUrl: "https://www.fedex.com/fedextrack/?trknbr=TRACK%20123",
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
      fulfillment: resolvedFulfillment,
    };
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue(order);
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateCustomerOrderStatus,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    const updateOrderStatus = vi.fn().mockResolvedValue(order);
    createTenantOrderAdapter.mockResolvedValue({
      updateOrderStatus,
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
          fulfillment,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Shipped",
      resolvedFulfillment,
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Shipped",
      fulfillment: resolvedFulfillment,
    });
  });

  it("rejects backward status transitions", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          status: "Shipped",
        },
      ]),
    });

    const response = await PATCH(
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

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "invalid_status_transition",
    });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });

  it("rejects Delivered when the platform order has not been Shipped", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          status: "Processing",
        },
      ]),
    });

    const response = await PATCH(
      new Request("http://store.localhost:3000/api/tenant/orders", {
        method: "PATCH",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orderId, status: "Delivered" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "invalid_status_transition",
    });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });

  it("allows operators to mark a shipped order delivered", async () => {
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Delivered",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [],
      total: 0,
      currency: "USD",
      itemCount: 1,
    };
    const shippedOrder = { ...order, status: "Shipped" };
    const updateOrderStatus = vi.fn().mockResolvedValue(order);
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue(order);
    getTenantPortalSession.mockResolvedValue({
      userId: customerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:read", "orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([shippedOrder]),
      updateCustomerOrderStatus,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
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
        body: JSON.stringify({ orderId, status: "Delivered" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Delivered",
      undefined,
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith({
      tenantId,
      orderId,
      status: "Delivered",
    });
    expect(await response.json()).toMatchObject({
      order: { id: orderId, status: "Delivered" },
    });
  });
});
