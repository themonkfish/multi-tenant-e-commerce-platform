import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomerSession,
  getPlatformStore,
  createTenantCatalogAdapter,
  syncCustomerOrderToTenant,
  retrieveStripeCheckoutSession,
  getStripeConfiguration,
  isSameOrigin,
  canAccessPermission,
} = vi.hoisted(() => ({
  getCustomerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  createTenantCatalogAdapter: vi.fn(),
  syncCustomerOrderToTenant: vi.fn(),
  retrieveStripeCheckoutSession: vi.fn(),
  getStripeConfiguration: vi.fn(),
  isSameOrigin: vi.fn(),
  canAccessPermission: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant,
}));
vi.mock("@/lib/server/http", () => ({ isSameOrigin }));
vi.mock("@/core/tenancy/scope", () => ({ canAccessPermission }));
vi.mock("@/lib/server/stripe-payments", () => ({
  retrieveStripeCheckoutSession,
  getStripeConfiguration,
  StripePaymentConfigurationError: class StripePaymentConfigurationError extends Error {},
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440020";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function request() {
  return new Request(
    `https://store.example.com/api/customer/orders/${orderId}/reconcile`,
    {
      method: "POST",
      headers: {
        origin: "https://store.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: "cs_test_reconcile" }),
    },
  );
}

describe("POST /api/customer/orders/[orderId]/reconcile", () => {
  afterEach(() => vi.clearAllMocks());

  it("reconciles a paid Stripe Checkout session and syncs the order", async () => {
    isSameOrigin.mockReturnValue(true);
    canAccessPermission.mockReturnValue(true);
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed",
      paymentMethod: "stripe",
      paymentStatus: "pending",
      paymentAttempt: 1,
      paymentSessionId: "cs_test_reconcile",
      paymentIntentId: undefined,
      currency: "USD",
      total: 2500,
      discountCode: "SAVE10",
      items: [
        {
          productId: "product-1",
          inventoryTracked: true,
          quantity: 1,
        },
      ],
      backendSyncStatus: "pending",
    };
    const paid = { ...order, paymentStatus: "paid" };
    const synced = { ...paid, backendSyncStatus: "synced" };
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment: vi.fn().mockResolvedValue(paid),
      commitDiscountRedemption: vi.fn().mockResolvedValue(undefined),
    };
    getPlatformStore.mockReturnValue(store);
    retrieveStripeCheckoutSession.mockResolvedValue({
      id: "cs_test_reconcile",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      client_reference_id: orderId,
      amount_total: 2500,
      currency: "usd",
      metadata: {
        tenantId,
        customerId,
        orderId,
        paymentMode: "test",
      },
      payment_intent: "pi_test_reconcile",
    });
    getStripeConfiguration.mockReturnValue({
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      mode: "test",
    });
    createTenantCatalogAdapter.mockResolvedValue({
      commitInventory: vi.fn().mockResolvedValue(undefined),
    });
    syncCustomerOrderToTenant.mockResolvedValue(synced);

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ order: synced });
    expect(store.updateCustomerOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paid",
        paymentIntentId: "pi_test_reconcile",
      }),
    );
  });

  it("rejects a session that does not belong to the customer order", async () => {
    isSameOrigin.mockReturnValue(true);
    canAccessPermission.mockReturnValue(true);
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      getCustomerOrder: vi.fn().mockResolvedValue({
        id: orderId,
        tenantId,
        customerId,
        paymentMethod: "stripe",
        paymentStatus: "pending",
        paymentSessionId: "cs_test_other",
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ orderId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "stale_payment_session",
    });
  });
});
