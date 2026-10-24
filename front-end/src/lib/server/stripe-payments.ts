import "server-only";
import Stripe from "stripe";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { getServerEnv } from "@/lib/server/env";

export class StripePaymentConfigurationError extends Error {
  constructor() {
    super("Stripe test-mode keys are not configured");
    this.name = "StripePaymentConfigurationError";
  }
}

function getStripeConfiguration() {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = getServerEnv();
  if (
    !STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
    !STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")
  ) {
    throw new StripePaymentConfigurationError();
  }
  return { secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET };
}

function createStripeClient(secretKey: string) {
  return new Stripe(secretKey);
}

export async function createStripeCheckoutSession(input: {
  order: CustomerOrder;
  attempt: number;
  successUrl: string;
  cancelUrl: string;
}) {
  const { secretKey } = getStripeConfiguration();
  if (input.order.paymentStatus !== "pending") {
    throw new Error("Only unpaid orders can start a checkout session");
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new Error("Checkout attempt must be a positive integer");
  }
  if (
    input.order.total < 1 ||
    input.order.items.some((item) => item.unitPrice < 1)
  ) {
    throw new Error("Stripe Checkout requires a positive order amount");
  }

  const metadata = {
    tenantId: input.order.tenantId,
    customerId: input.order.customerId,
    orderId: input.order.id,
  };
  return createStripeClient(secretKey).checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: input.order.id,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      payment_intent_data: { metadata },
      line_items: input.order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: item.currency.toLowerCase(),
          unit_amount: item.unitPrice,
          product_data: {
            name: [
              item.title,
              item.variantSelections
                ? Object.entries(item.variantSelections)
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(", ")
                : "",
            ]
              .filter(Boolean)
              .join(" — "),
            metadata: {
              productId: item.productId,
              slug: item.slug,
            },
          },
        },
      })),
    },
    {
      idempotencyKey: `${input.order.tenantId}-${input.order.id}-${input.attempt}`,
    },
  );
}

export async function retrieveStripeCheckoutSession(sessionId: string) {
  const { secretKey } = getStripeConfiguration();
  return createStripeClient(secretKey).checkout.sessions.retrieve(sessionId);
}

export function verifyStripeWebhookEvent(
  payload: string,
  signature: string,
): Stripe.Event {
  const { secretKey, webhookSecret } = getStripeConfiguration();
  return createStripeClient(secretKey).webhooks.constructEvent(
    payload,
    signature,
    webhookSecret,
  );
}
