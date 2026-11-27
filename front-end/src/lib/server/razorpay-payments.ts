import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { getServerEnv } from "@/lib/server/env";

const RAZORPAY_API = "https://api.razorpay.com";

export class RazorpayPaymentConfigurationError extends Error {
  constructor() {
    super("Razorpay payment keys are not configured");
    this.name = "RazorpayPaymentConfigurationError";
  }
}

export type RazorpayCheckoutOrder = {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
};

export function getRazorpayConfiguration(): {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  mode: "test" | "live";
} {
  const env = getServerEnv();
  if (
    !env.RAZORPAY_KEY_ID ||
    !env.RAZORPAY_KEY_SECRET ||
    !env.RAZORPAY_WEBHOOK_SECRET
  ) {
    throw new RazorpayPaymentConfigurationError();
  }
  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    mode: env.RAZORPAY_KEY_ID.startsWith("rzp_live_") ? "live" : "test",
  };
}

export async function createRazorpayCheckoutOrder(input: {
  order: CustomerOrder;
  storeName: string;
}): Promise<RazorpayCheckoutOrder> {
  if (input.order.paymentStatus !== "pending") {
    throw new Error("Only unpaid orders can start a Razorpay checkout");
  }
  if (input.order.paymentMethod !== "razorpay") {
    throw new Error("Razorpay can only be used for Razorpay orders");
  }
  if (input.order.currency !== "INR" || input.order.total < 100) {
    throw new Error("Razorpay Checkout requires a positive INR order amount");
  }
  const config = getRazorpayConfiguration();
  const response = await fetch(`${RAZORPAY_API}/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64"),
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      amount: input.order.total,
      currency: "INR",
      receipt: input.order.id,
      notes: {
        tenantId: input.order.tenantId,
        customerId: input.order.customerId,
        orderId: input.order.id,
        paymentMode: config.mode,
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | {
        id?: string;
        amount?: number;
        currency?: string;
        error?: { description?: string };
      }
    | null;
  if (!response.ok || !body?.id || body.amount !== input.order.total) {
    throw new Error(
      body?.error?.description || "Razorpay order creation failed",
    );
  }
  return {
    keyId: config.keyId,
    orderId: body.id,
    amount: body.amount,
    currency: "INR",
    name: input.storeName,
    description: `Order ${input.order.id}`,
  };
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = getRazorpayConfiguration();
  const expected = createHmac("sha256", keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  const supplied = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    supplied.length === expectedBuffer.length &&
    timingSafeEqual(supplied, expectedBuffer)
  );
}

export function verifyRazorpayWebhookSignature(
  payload: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const { webhookSecret } = getRazorpayConfiguration();
  const expected = createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    /^[a-fA-F0-9]{64}$/.test(signature) &&
    supplied.length === expectedBuffer.length &&
    timingSafeEqual(supplied, expectedBuffer)
  );
}

export async function createRazorpayRefund(input: {
  order: CustomerOrder;
  paymentIntentId: string;
}) {
  if (input.order.paymentMethod !== "razorpay") {
    throw new Error("Only Razorpay orders can be refunded");
  }
  if (input.order.paymentStatus !== "paid") {
    throw new Error("Only paid orders can be refunded");
  }
  const config = getRazorpayConfiguration();
  const response = await fetch(
    `${RAZORPAY_API}/v1/payments/${encodeURIComponent(input.paymentIntentId)}/refund`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64"),
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ amount: input.order.total }),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | { id?: string; status?: string }
    | null;
  if (!response.ok || !body?.id) {
    throw new Error("Razorpay refund failed");
  }
  return body;
}

export function createRazorpayEventId(payload: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `razorpay-${digest}`;
}
