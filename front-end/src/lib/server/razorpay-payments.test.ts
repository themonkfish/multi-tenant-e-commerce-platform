import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import {
  createRazorpayCheckoutOrder,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from "./razorpay-payments";

const order = {
  id: "ORD-550e8400-e29b-41d4-a716-446655440001",
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
  customerId: "550e8400-e29b-41d4-a716-446655440002",
  status: "Confirmed",
  createdAt: "2026-11-27T10:00:00.000Z",
  items: [],
  total: 10000,
  currency: "INR",
  itemCount: 1,
  paymentMethod: "razorpay",
  paymentStatus: "pending",
  paymentAttempt: 1,
  backendSyncStatus: "not_configured",
} satisfies CustomerOrder;

describe("Razorpay payments", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates an idempotent Razorpay order with platform metadata", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_test");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test-secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "test-webhook-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "order_R123",
          amount: 10000,
          currency: "INR",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRazorpayCheckoutOrder({
        order,
        storeName: "Test Store",
      }),
    ).resolves.toEqual({
      keyId: "rzp_test_test",
      orderId: "order_R123",
      amount: 10000,
      currency: "INR",
      name: "Test Store",
      description: `Order ${order.id}`,
    });
    const init = vi.mocked(fetchMock).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      amount: 10000,
      currency: "INR",
      receipt: order.id,
      notes: {
        tenantId: order.tenantId,
        customerId: order.customerId,
        orderId: order.id,
      },
    });
  });

  it("verifies payment and webhook HMAC signatures", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_test");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test-secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "test-webhook-secret");
    const payload = JSON.stringify({ event: "payment.captured" });
    const paymentSignature = createHmac("sha256", "test-secret")
      .update("order_R123|pay_R123")
      .digest("hex");
    const webhookSignature = createHmac("sha256", "test-webhook-secret")
      .update(payload)
      .digest("hex");
    expect(
      verifyRazorpayPaymentSignature({
        orderId: "order_R123",
        paymentId: "pay_R123",
        signature: paymentSignature,
      }),
    ).toBe(true);
    expect(
      verifyRazorpayWebhookSignature(payload, webhookSignature),
    ).toBe(true);
  });
});
