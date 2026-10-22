import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyStripeWebhookEvent } from "./stripe-payments";

const webhookSecret = "whsec_test_webhook_secret";

describe("Stripe webhook verification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a valid Stripe test webhook signature and rejects tampering", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_checkout_secret");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
    const event = {
      id: "evt_test_checkout",
      object: "event",
      api_version: Stripe.API_VERSION,
      created: 1_782_102_400,
      data: {
        object: {
          id: "cs_test_checkout",
          object: "checkout.session",
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: "checkout.session.completed",
    };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    expect(verifyStripeWebhookEvent(payload, signature)).toMatchObject({
      id: "evt_test_checkout",
      type: "checkout.session.completed",
    });
    expect(() => verifyStripeWebhookEvent(`${payload} `, signature)).toThrow();
  });

  it("refuses live-mode API keys", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_allowed");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
    expect(() => verifyStripeWebhookEvent("{}", "t=1,v1=invalid")).toThrow(
      "Stripe test-mode keys are not configured",
    );
  });
});
