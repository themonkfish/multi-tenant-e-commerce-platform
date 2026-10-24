import "server-only";
import Stripe from "stripe";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { calculateTaxAmount } from "@/core/domain/tax";
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
