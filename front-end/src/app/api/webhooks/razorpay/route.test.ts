import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getPlatformStore } = vi.hoisted(() => ({
  getPlatformStore: vi.fn(),
}));

vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter: vi.fn(),
}));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant: vi.fn(),
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const webhookSecret = "razorpay-webhook-test-secret";

function request(body: unknown, signature?: string) {
  const payload = JSON.stringify(body);
  const validSignature =
    signature ??
    createHmac("sha256", webhookSecret).update(payload).digest("hex");
  return new Request("https://store.example.test/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
      "x-razorpay-signature": validSignature,
    },
    body: payload,
  });
}

describe("POST /api/webhooks/razorpay", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects an invalid webhook signature", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_test");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test-secret");

    const response = await POST(
      request(
        { event: "payment.captured", payload: {} },
        "0".repeat(64),
      ),
    );

    expect(response.status).toBe(401);
  });

  it("rejects malformed payment metadata", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_test");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test-secret");

    const response = await POST(
      request({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_R123",
              order_id: "order_R123",
              amount: 10000,
              currency: "INR",
              notes: {},
            },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_order_metadata",
    });
  });

  it("accepts a captured payment and updates the platform order", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_test");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test-secret");
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed",
      total: 10000,
      currency: "INR",
      items: [],
      paymentMethod: "razorpay",
      paymentStatus: "pending",
      paymentAttempt: 1,
      paymentSessionId: "order_R123",
      backendSyncStatus: "synced",
    };
    const updated = { ...order, paymentStatus: "paid" };
    getPlatformStore.mockReturnValue({
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment: vi.fn().mockResolvedValue(updated),
      listHosts: vi.fn().mockResolvedValue([{ id: hostId }]),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId }]),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
      commitDiscountRedemption: vi.fn(),
    });

    const response = await POST(
      request({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_R123",
              order_id: "order_R123",
              amount: 10000,
              currency: "INR",
              notes: {
                tenantId,
                customerId,
                orderId,
              },
            },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ received: true }),
    );
  });
});
