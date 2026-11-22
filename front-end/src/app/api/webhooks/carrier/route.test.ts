import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getPlatformStore, createTenantOrderAdapter } = vi.hoisted(() => ({
  getPlatformStore: vi.fn(),
  createTenantOrderAdapter: vi.fn(),
}));

vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const secret = "carrier-test-secret-at-least-16";

function carrierRequest(body: unknown, signaturePayload?: string) {
  const payload =
    signaturePayload === undefined ? JSON.stringify(body) : signaturePayload;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return new Request("http://localhost:3000/api/webhooks/carrier", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
      "x-carrier-signature": `sha256=${signature}`,
    },
    body: payload,
  });
}

describe("POST /api/webhooks/carrier", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects invalid signatures", async () => {
    vi.stubEnv("CARRIER_WEBHOOK_SECRET", secret);
    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/carrier", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-carrier-signature": "sha256=not-valid",
        },
        body: JSON.stringify({ eventId: "evt-1" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  it("normalizes an in-transit event and syncs it to the tenant backend", async () => {
    vi.stubEnv("CARRIER_WEBHOOK_SECRET", secret);
    const platformOrder = {
      id: orderId,
      tenantId,
      customerId: "550e8400-e29b-41d4-a716-446655440020",
      status: "Processing",
      fulfillment: undefined,
    };
    const updateCustomerOrderStatus = vi.fn().mockResolvedValue({
      ...platformOrder,
      status: "Shipped",
    });
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    getPlatformStore.mockReturnValue({
      listTenantOrders: vi.fn().mockResolvedValue([platformOrder]),
      listHosts: vi.fn().mockResolvedValue([{ id: hostId, status: "active" }]),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId, status: "active" }]),
      updateCustomerOrderStatus,
      appendAuditEvent,
    });
    const updateOrderStatus = vi.fn().mockResolvedValue({
      ...platformOrder,
      status: "Shipped",
    });
    createTenantOrderAdapter.mockResolvedValue({ updateOrderStatus });

    const response = await POST(
      carrierRequest({
        eventId: "evt-in-transit-1",
        tenantId,
        orderId,
        trackingNumber: "TRACK-123",
        carrier: "FedEx",
        status: "in_transit",
      }),
    );

    expect(response.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "Shipped",
      expect.objectContaining({
        carrier: "FedEx",
        trackingNumber: "TRACK-123",
      }),
    );
    expect(updateCustomerOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        orderId,
        status: "Shipped",
      }),
    );
  });

  it("treats an identical carrier event as already received", async () => {
    vi.stubEnv("CARRIER_WEBHOOK_SECRET", secret);
    const fulfillment = {
      carrier: "FedEx",
      trackingNumber: "TRACK-123",
    };
    getPlatformStore.mockReturnValue({
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          tenantId,
          status: "Shipped",
          fulfillment,
        },
      ]),
    });

    const response = await POST(
      carrierRequest({
        eventId: "evt-repeat",
        tenantId,
        orderId,
        trackingNumber: "TRACK-123",
        carrier: "FedEx",
        status: "in_transit",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      eventId: "evt-repeat",
    });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });

  it("ignores a Processing event after an order is already Shipped", async () => {
    vi.stubEnv("CARRIER_WEBHOOK_SECRET", secret);
    getPlatformStore.mockReturnValue({
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          tenantId,
          status: "Shipped",
          fulfillment: {
            carrier: "FedEx",
            trackingNumber: "TRACK-123",
          },
        },
      ]),
    });

    const response = await POST(
      carrierRequest({
        eventId: "evt-picked-up-late",
        tenantId,
        orderId,
        trackingNumber: "TRACK-123",
        carrier: "FedEx",
        status: "picked_up",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
  });
});
