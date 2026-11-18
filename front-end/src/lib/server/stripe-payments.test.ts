import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStripeConfiguration,
  verifyStripeWebhookEvent,
} from "./stripe-payments";

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

  it("accepts live-mode API keys only in production", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_allowed");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("NODE_ENV", "test");
    expect(() => verifyStripeWebhookEvent("{}", "t=1,v1=invalid")).toThrow(
      "Stripe payment keys are not configured",
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("PLATFORM_SECRET_KEY", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("PLATFORM_STORE", "supabase");
    vi.stubEnv("PLATFORM_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("PLATFORM_SUPABASE_SERVICE_KEY", "service-key");
    expect(getStripeConfiguration()).toMatchObject({
      secretKey: "sk_live_not_allowed",
      mode: "live",
    });
  });
});
