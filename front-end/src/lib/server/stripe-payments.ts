import "server-only";
import Stripe from "stripe";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { calculateTaxAmount } from "@/core/domain/tax";
import { getServerEnv } from "@/lib/server/env";

export class StripePaymentConfigurationError extends Error {
  constructor() {
    super("Stripe payment keys are not configured");
    this.name = "StripePaymentConfigurationError";
  }
}

export class StripePaymentModeMismatchError extends Error {
  constructor() {
    super("Stripe event mode does not match the configured payment mode");
    this.name = "StripePaymentModeMismatchError";
  }
}

export type StripePaymentMode = "test" | "live";

export function getStripeConfiguration(): {
  secretKey: string;
  webhookSecret: string;
  mode: StripePaymentMode;
} {
  const { NODE_ENV, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = getServerEnv();
  if (!STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    throw new StripePaymentConfigurationError();
  }
  if (STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return {
      secretKey: STRIPE_SECRET_KEY,
      webhookSecret: STRIPE_WEBHOOK_SECRET,
      mode: "test",
    };
  }
  if (NODE_ENV === "production" && STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
    return {
      secretKey: STRIPE_SECRET_KEY,
      webhookSecret: STRIPE_WEBHOOK_SECRET,
      mode: "live",
    };
  }
  throw new StripePaymentConfigurationError();
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
  const itemSubtotal = input.order.items.reduce(
    (total, item) => total + item.unitPrice * item.quantity,
    0,
  );
  const discountAmount = input.order.discountAmount ?? 0;
  const taxAmount = input.order.taxAmount ?? 0;
  const taxRateBasisPoints = input.order.taxRateBasisPoints ?? 0;
  if (
    !Number.isSafeInteger(itemSubtotal) ||
    itemSubtotal !== (input.order.subtotal ?? itemSubtotal) ||
    discountAmount > itemSubtotal ||
    taxAmount !==
      calculateTaxAmount(itemSubtotal - discountAmount, taxRateBasisPoints) ||
    (discountAmount > 0 && !input.order.discountCode) ||
    itemSubtotal -
      discountAmount +
      taxAmount +
      (input.order.shippingAmount ?? 0) !==
      input.order.total
  ) {
    throw new Error("Stripe Checkout order amounts do not match");
  }

  const metadata = {
    tenantId: input.order.tenantId,
    customerId: input.order.customerId,
    orderId: input.order.id,
    paymentMode: getStripeConfiguration().mode,
    ...(input.order.discountCode
      ? { discountCode: input.order.discountCode }
      : {}),
    ...(discountAmount > 0 ? { discountAmount: String(discountAmount) } : {}),
    ...(taxAmount > 0 ? { taxAmount: String(taxAmount) } : {}),
    ...(taxRateBasisPoints > 0
      ? { taxRateBasisPoints: String(taxRateBasisPoints) }
      : {}),
  };
  const itemLineItems =
    discountAmount > 0
      ? [
          {
            quantity: 1,
            price_data: {
              currency: input.order.currency.toLowerCase(),
              unit_amount: itemSubtotal - discountAmount,
              product_data: {
                name: `Items after ${input.order.discountCode} discount`,
                description: `Subtotal ${itemSubtotal}; discount ${discountAmount}`,
              },
            },
          },
        ]
      : input.order.items.map((item) => ({
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
                ...(item.sku ? { sku: item.sku } : {}),
              },
            },
          },
        }));
  return createStripeClient(secretKey).checkout.sessions.create(
    {
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      client_reference_id: input.order.id,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        ...itemLineItems,
        ...(taxAmount > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: input.order.currency.toLowerCase(),
                  unit_amount: taxAmount,
                  product_data: { name: "Tax" },
                },
              },
            ]
          : []),
        ...((input.order.shippingAmount ?? 0) > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: input.order.currency.toLowerCase(),
                  unit_amount: input.order.shippingAmount ?? 0,
                  product_data: { name: "Shipping" },
                },
              },
            ]
          : []),
      ],
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

export async function createStripeRefund(input: {
  order: CustomerOrder;
  paymentIntentId: string;
}) {
  if (input.order.paymentMethod !== "stripe") {
    throw new Error("Only Stripe orders can be refunded");
  }
  if (input.order.paymentStatus !== "paid") {
    throw new Error("Only paid orders can be refunded");
  }
  if (!input.paymentIntentId) {
    throw new Error("A Stripe payment intent is required");
  }
  const { secretKey } = getStripeConfiguration();
  return createStripeClient(secretKey).refunds.create(
    { payment_intent: input.paymentIntentId, amount: input.order.total },
    {
      idempotencyKey: `${input.order.tenantId}-${input.order.id}-refund`,
    },
  );
}

export function verifyStripeWebhookEvent(
  payload: string,
  signature: string,
): Stripe.Event {
  const { secretKey, webhookSecret, mode } = getStripeConfiguration();
  const event = createStripeClient(secretKey).webhooks.constructEvent(
    payload,
    signature,
    webhookSecret,
  );
  if (event.livemode !== (mode === "live")) {
    throw new StripePaymentModeMismatchError();
  }
  return event;
}
