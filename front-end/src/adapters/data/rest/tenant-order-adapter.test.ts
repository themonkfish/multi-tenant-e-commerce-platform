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
        total: order.total,
        currency: order.currency,
        itemCount: order.itemCount,
      },
    });
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
});
