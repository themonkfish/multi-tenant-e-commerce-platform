import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getPlatformStore,
  createTenantCatalogAdapter,
  syncCustomerOrderToTenant,
  verifyStripeWebhookEvent,
} = vi.hoisted(() => ({
  getPlatformStore: vi.fn(),
  createTenantCatalogAdapter: vi.fn(),
  syncCustomerOrderToTenant: vi.fn(),
  verifyStripeWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant,
}));
vi.mock("@/lib/server/stripe-payments", () => ({
  verifyStripeWebhookEvent,
  StripePaymentConfigurationError: class StripePaymentConfigurationError extends Error {},
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const sessionId = "cs_test_checkout_1";

function checkoutEvent(type = "checkout.session.completed") {
  return {
    id: "evt_test_payment_1",
    type,
    data: {
      object: {
        id: sessionId,
        mode: "payment",
        client_reference_id: orderId,
        amount_total: 2500,
        currency: "usd",
        metadata: { tenantId, customerId, orderId },
        payment_status: "paid",
        payment_intent: "pi_test_payment_1",
      },
    },
  };
}

function webhookRequest() {
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "test-signature",
    },
    body: JSON.stringify({ signed: "payload" }),
  });
}

describe("Stripe payment webhook", () => {
  afterEach(() => vi.clearAllMocks());

  it("marks the scoped order paid and only then delivers it to the Tenant backend", async () => {
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [],
      total: 2500,
      currency: "USD",
      itemCount: 1,
      paymentStatus: "pending",
      paymentAttempt: 1,
      paymentSessionId: sessionId,
      backendSyncStatus: "not_configured",
    };
    const updateCustomerOrderPayment = vi.fn().mockResolvedValue({
      ...order,
      paymentStatus: "paid",
      paymentIntentId: "pi_test_payment_1",
    });
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment,
      listHosts: vi.fn().mockResolvedValue([{ id: hostId, status: "active" }]),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId, status: "active" }]),
    };
    getPlatformStore.mockReturnValue(store);
    verifyStripeWebhookEvent.mockReturnValue(checkoutEvent());
    syncCustomerOrderToTenant.mockResolvedValue({
      ...order,
      paymentStatus: "paid",
      backendSyncStatus: "synced",
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(updateCustomerOrderPayment).toHaveBeenCalledWith({
      tenantId,
      customerId,
      orderId,
      sessionId,
      status: "paid",
      paymentIntentId: "pi_test_payment_1",
    });
    expect(syncCustomerOrderToTenant).toHaveBeenCalledWith({
      store,
      tenantId,
      hostId,
      order: expect.objectContaining({ paymentStatus: "paid" }),
    });
  });

  it("rejects stale sessions and does not downgrade a paid order", async () => {
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [],
      total: 2500,
      currency: "USD",
      itemCount: 1,
      paymentStatus: "paid",
      paymentAttempt: 1,
      paymentSessionId: "cs_test_newer_session",
      backendSyncStatus: "synced",
    };
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment: vi.fn(),
      listHosts: vi.fn().mockResolvedValue([{ id: hostId, status: "active" }]),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId, status: "active" }]),
    };
    getPlatformStore.mockReturnValue(store);
    verifyStripeWebhookEvent.mockReturnValue(checkoutEvent());

    const staleResponse = await POST(webhookRequest());
    expect(staleResponse.status).toBe(409);
    expect(store.updateCustomerOrderPayment).not.toHaveBeenCalled();

    order.paymentSessionId = sessionId;
    verifyStripeWebhookEvent.mockReturnValue(
      checkoutEvent("checkout.session.expired"),
    );
    const expiredResponse = await POST(webhookRequest());
    expect(expiredResponse.status).toBe(200);
    expect(store.updateCustomerOrderPayment).not.toHaveBeenCalled();
    expect(syncCustomerOrderToTenant).not.toHaveBeenCalled();
  });

  it("records failed asynchronous payments without delivering the order", async () => {
    const order = {
      id: orderId,
      tenantId,
      customerId,
      status: "Confirmed",
      createdAt: "2026-10-22T12:00:00.000Z",
      items: [
        {
          productId: "product-1",
          quantity: 1,
          inventoryTracked: true,
          variantSelections: { Size: "M" },
        },
      ],
      total: 2500,
      currency: "USD",
      itemCount: 1,
      paymentStatus: "pending",
      paymentAttempt: 1,
      paymentSessionId: sessionId,
      backendSyncStatus: "not_configured",
    };
    const store = {
      getCustomerOrder: vi.fn().mockResolvedValue(order),
      updateCustomerOrderPayment: vi.fn().mockResolvedValue({
        ...order,
        paymentStatus: "failed",
      }),
      listHosts: vi.fn().mockResolvedValue([{ id: hostId, status: "active" }]),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId, status: "active" }]),
    };
    const releaseInventory = vi.fn().mockResolvedValue(undefined);
    getPlatformStore.mockReturnValue(store);
    createTenantCatalogAdapter.mockResolvedValue({ releaseInventory });
    verifyStripeWebhookEvent.mockReturnValue(
      checkoutEvent("checkout.session.async_payment_failed"),
    );

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(store.updateCustomerOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", sessionId }),
    );
    expect(releaseInventory).toHaveBeenCalledWith(`${orderId}-1`);
    expect(syncCustomerOrderToTenant).not.toHaveBeenCalled();

    store.getCustomerOrder.mockResolvedValue({
      ...order,
      paymentStatus: "failed",
    });
    const retryResponse = await POST(webhookRequest());
    expect(retryResponse.status).toBe(200);
    expect(releaseInventory).toHaveBeenCalledTimes(2);
  });
});
