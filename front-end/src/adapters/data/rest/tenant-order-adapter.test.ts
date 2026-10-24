import { describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { RestBackendError } from "./catalog-adapter";
import type { RestHttpResponse } from "./safe-http";
import { RestTenantOrderAdapter } from "./tenant-order-adapter";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const config = {
  type: "rest" as const,
  baseUrl: "https://api.example.com",
  apiVersion: "v1",
  authMode: "apiKey" as const,
  apiKeyRef: "api-key-ref",
};
const order: CustomerOrder = {
  id: "ORD-550e8400-e29b-41d4-a716-446655440001",
  tenantId,
  customerId: "550e8400-e29b-41d4-a716-446655440002",
  status: "Confirmed",
  createdAt: "2026-10-22T12:00:00.000Z",
  items: [
    {
      productId: "product-1",
      title: "Canvas Bag",
      slug: "canvas-bag",
      quantity: 2,
      unitPrice: 1250,
      currency: "USD",
    },
  ],
  total: 2500,
  currency: "USD",
  itemCount: 2,
  subtotal: 2500,
  shippingAmount: 0,
  taxRateBasisPoints: 0,
  taxAmount: 0,
  paymentMethod: "stripe",
  paymentStatus: "paid",
  paymentAttempt: 0,
  backendSyncStatus: "pending",
};

function mockTransport(body: unknown, status = 201) {
  return vi.fn(async (): Promise<RestHttpResponse> => ({ status, body }));
}

describe("RestTenantOrderAdapter", () => {
  it("sends a tenant-scoped order snapshot without platform sync metadata", async () => {
    const transport = mockTransport({ order });
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );
    await expect(adapter.createOrder(order)).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledWith(config, "api-secret", {
      method: "POST",
      path: "/orders",
      body: {
        id: order.id,
        tenantId,
        customerId: order.customerId,
        status: order.status,
        createdAt: order.createdAt,
        items: order.items,
        subtotal: 2500,
        shippingAmount: 0,
        taxRateBasisPoints: 0,
        taxAmount: 0,
        total: order.total,
        currency: order.currency,
        itemCount: order.itemCount,
        paymentMethod: "stripe",
      },
    });
  });

  it("sends accepted cash-on-delivery orders with their delivery details", async () => {
    const codOrder: CustomerOrder = {
      ...order,
      currency: "INR",
      items: order.items.map((item) => ({ ...item, currency: "INR" })),
      paymentMethod: "cash_on_delivery",
      paymentStatus: "cod_due",
      deliveryAddress: {
        fullName: "Test Customer",
        line1: "1 Market Road",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "IN",
        phone: "+919876543210",
      },
    };
    const transport = mockTransport({ order: codOrder });
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );
    await expect(adapter.createOrder(codOrder)).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledWith(
      config,
      "api-secret",
      expect.objectContaining({
        body: expect.objectContaining({
          paymentMethod: "cash_on_delivery",
          deliveryAddress: codOrder.deliveryAddress,
        }),
      }),
    );
  });

  it("rejects cross-tenant orders and mismatched backend responses", async () => {
    const transport = mockTransport({ order });
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );
    await expect(
      adapter.createOrder({
        ...order,
        tenantId: "550e8400-e29b-41d4-a716-446655440099",
      }),
    ).rejects.toThrow("outside the configured tenant scope");
    await expect(
      new RestTenantOrderAdapter(
        config,
        "api-secret",
        tenantId,
        mockTransport({ order: { ...order, id: "other-order" } }),
      ).createOrder(order),
    ).rejects.toThrow("mismatched order");
    expect(transport).not.toHaveBeenCalled();
  });

  it("never sends an unpaid order to a Tenant backend", async () => {
    const transport = mockTransport({ order });
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );

    await expect(
      adapter.createOrder({ ...order, paymentStatus: "pending" }),
    ).rejects.toThrow("paid or accepted cash-on-delivery");
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps backend errors without exposing response content", async () => {
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      mockTransport({ error: "private backend detail" }, 503),
    );
    await expect(adapter.createOrder(order)).rejects.toMatchObject({
      name: "RestBackendError",
      status: 503,
    } satisfies Partial<RestBackendError>);
    await expect(adapter.createOrder(order)).rejects.not.toThrow(
      "private backend detail",
    );
  });

  it("lists paginated orders and updates only a scoped order's status", async () => {
    const tenantOrder = {
      id: order.id,
      tenantId,
      customerId: order.customerId,
      status: "Confirmed",
      createdAt: order.createdAt,
      items: order.items,
      total: order.total,
      currency: order.currency,
      itemCount: order.itemCount,
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: {
          data: [tenantOrder],
          meta: { page: 2, limit: 10, total: 12 },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { order: { ...tenantOrder, status: "Processing" } },
      });
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );

    await expect(adapter.listOrders(2, 10)).resolves.toMatchObject({
      meta: { page: 2, limit: 10, total: 12 },
      data: [{ id: order.id }],
    });
    await expect(
      adapter.updateOrderStatus(order.id, "Processing"),
    ).resolves.toMatchObject({ id: order.id, status: "Processing" });
    expect(transport).toHaveBeenNthCalledWith(
      1,
      config,
      "api-secret",
      expect.objectContaining({
        method: "GET",
        path: "/orders",
        query: new URLSearchParams({ page: "2", limit: "10" }),
      }),
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      config,
      "api-secret",
      expect.objectContaining({
        method: "PATCH",
        path: `/orders/${order.id}`,
        body: { status: "Processing" },
      }),
    );
    await expect(adapter.listOrders(0, 10)).rejects.toThrow("pagination");
  });

  it("sends optional shipment tracking details when marking an order shipped", async () => {
    const tenantOrder = {
      id: order.id,
      tenantId,
      customerId: order.customerId,
      status: "Shipped",
      createdAt: order.createdAt,
      items: order.items,
      total: order.total,
      currency: order.currency,
      itemCount: order.itemCount,
    };
    const fulfillment = {
      carrier: "Parcel service",
      trackingNumber: "TRACK-123",
      trackingUrl: "https://tracking.example.com/TRACK-123",
    };
    const transport = mockTransport({ order: tenantOrder }, 200);
    const adapter = new RestTenantOrderAdapter(
      config,
      "api-secret",
      tenantId,
      transport,
    );

    await expect(
      adapter.updateOrderStatus(order.id, "Shipped", fulfillment),
    ).resolves.toMatchObject({ ...tenantOrder, fulfillment });
    expect(transport).toHaveBeenCalledWith(config, "api-secret", {
      method: "PATCH",
      path: `/orders/${order.id}`,
      body: { status: "Shipped", fulfillment },
    });
  });
});
