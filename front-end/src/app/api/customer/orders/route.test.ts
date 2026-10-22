import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomerSession,
  getPlatformStore,
  createTenantCatalogAdapter,
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
} = vi.hoisted(() => ({
  getCustomerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  createTenantCatalogAdapter: vi.fn(),
  createStripeCheckoutSession: vi.fn(),
  retrieveStripeCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/stripe-payments", () => ({
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  StripePaymentConfigurationError: class StripePaymentConfigurationError extends Error {},
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_example";
const product = {
  id: "product-1",
  tenantId,
  title: "Canvas Bag",
  slug: "canvas-bag",
  status: "active",
  price: { amount: 1250, currency: "USD" },
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
};

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    tenantId,
    customerId,
    status: "Confirmed",
    createdAt: "2026-10-22T12:00:00.000Z",
    items: [
      {
        productId: product.id,
        title: product.title,
        slug: product.slug,
        quantity: 2,
        unitPrice: product.price.amount,
        currency: product.price.currency,
      },
    ],
    total: 2500,
    currency: "USD",
    itemCount: 2,
    paymentStatus: "pending",
    paymentAttempt: 0,
    backendSyncStatus: "not_configured",
    ...overrides,
  };
}

function checkoutRequest() {
  return new Request("http://store.localhost:3000/api/customer/orders", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
      items: [{ productId: product.id, quantity: 2 }],
    }),
  });
}

describe("POST /api/customer/orders Stripe checkout", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates a server-priced unpaid order and returns a hosted Stripe URL", async () => {
    const order = makeOrder();
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn().mockResolvedValue({ order, created: true }),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
      prepareCustomerOrderPayment: vi.fn().mockResolvedValue({
        order: { ...order, paymentAttempt: 1 },
        attempt: 1,
      }),
      saveCustomerOrderPaymentSession: vi.fn().mockResolvedValue({
        ...order,
        paymentAttempt: 1,
        paymentSessionId: "cs_test_example",
      }),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(store);
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(product),
    });
    createStripeCheckoutSession.mockResolvedValue({
      id: "cs_test_example",
      url: checkoutUrl,
    });

    const response = await POST(checkoutRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkoutUrl).toBe(checkoutUrl);
    expect(body.order).toMatchObject({
      paymentStatus: "pending",
      paymentSessionId: "cs_test_example",
    });
    expect(store.createCustomerOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 2500,
        paymentStatus: "pending",
        backendSyncStatus: "not_configured",
      }),
    );
    expect(createStripeCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          total: 2500,
          items: [expect.objectContaining({ unitPrice: 1250, quantity: 2 })],
        }),
        attempt: 1,
        successUrl: expect.stringContaining(
          "session_id=%7BCHECKOUT_SESSION_ID%7D",
        ),
        cancelUrl: "http://store.localhost:3000/en/cart?payment=cancelled",
      }),
    );
    expect(store.saveCustomerOrderPaymentSession).toHaveBeenCalledWith({
      tenantId,
      customerId,
      orderId,
      attempt: 1,
      sessionId: "cs_test_example",
    });
  });

  it("reuses an open payment session for a matching idempotent retry", async () => {
    const order = makeOrder({
      paymentAttempt: 1,
      paymentSessionId: "cs_test_example",
    });
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(order),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(store);
    retrieveStripeCheckoutSession.mockResolvedValue({
      id: "cs_test_example",
      status: "open",
      url: checkoutUrl,
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order,
      checkoutUrl,
    });
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with a different cart", async () => {
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi
        .fn()
        .mockResolvedValue(
          makeOrder({ items: [{ productId: product.id, quantity: 1 }] }),
        ),
    });

    const response = await POST(checkoutRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "idempotency_key_conflict",
    });
    expect(createTenantCatalogAdapter).not.toHaveBeenCalled();
  });
});
