import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomerSession,
  getPlatformStore,
  createTenantCatalogAdapter,
  syncCustomerOrderToTenant,
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  createDemoCheckoutSessionId,
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
} = vi.hoisted(() => ({
  getCustomerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  createTenantCatalogAdapter: vi.fn(),
  syncCustomerOrderToTenant: vi.fn(),
  createStripeCheckoutSession: vi.fn(),
  retrieveStripeCheckoutSession: vi.fn(),
  createDemoCheckoutSessionId: vi.fn(),
  isDemoCheckoutSession: vi.fn(),
  isLocalDemoCheckoutEnabled: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/customer-order-sync", () => ({
  syncCustomerOrderToTenant,
}));
vi.mock("@/lib/server/stripe-payments", () => ({
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  StripePaymentConfigurationError: class StripePaymentConfigurationError extends Error {},
}));
vi.mock("@/lib/server/demo-checkout", () => ({
  createDemoCheckoutSessionId,
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440002";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_example";
const deliveryAddress = {
  fullName: "Test Customer",
  line1: "1 Market Road",
  city: "Pune",
  state: "Maharashtra",
  postalCode: "411001",
  country: "IN",
  phone: "+919876543210",
};
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
    subtotal: 2500,
    shippingAmount: 0,
    currency: "USD",
    itemCount: 2,
    deliveryAddress,
    paymentMethod: "stripe",
    paymentStatus: "pending",
    paymentAttempt: 0,
    backendSyncStatus: "not_configured",
    ...overrides,
  };
}

function checkoutRequest(
  items: {
    productId: string;
    quantity: number;
    variantSelections?: Record<string, string>;
  }[] = [{ productId: product.id, quantity: 2 }],
) {
  return new Request("http://store.localhost:3000/api/customer/orders", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
      deliveryAddress,
      items,
    }),
  });
}

function cashOnDeliveryRequest() {
  return new Request("http://store.localhost:3000/api/customer/orders", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
      paymentMethod: "cash_on_delivery",
      deliveryAddress,
      items: [{ productId: product.id, quantity: 2 }],
    }),
  });
}

describe("POST /api/customer/orders Stripe checkout", () => {
  afterEach(() => {
    isLocalDemoCheckoutEnabled.mockReturnValue(false);
    isDemoCheckoutSession.mockImplementation((sessionId: string) =>
      sessionId.startsWith("demo_"),
    );
    syncCustomerOrderToTenant.mockImplementation(
      async ({ order }: { order: ReturnType<typeof makeOrder> }) => order,
    );
    vi.clearAllMocks();
  });

  function withShippingSettings(
    store: Record<string, unknown>,
    currency = "USD",
    shipping: { flatRate: number; freeShippingThreshold?: number } = {
      flatRate: 0,
    },
  ) {
    return {
      ...store,
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        locale: { currency },
        shipping,
      }),
    };
  }

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
    getPlatformStore.mockReturnValue(
      withShippingSettings(store, "USD", {
        flatRate: 200,
        freeShippingThreshold: 2500,
      }),
    );
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
        subtotal: 2500,
        shippingAmount: 0,
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

  it("requires an Indian delivery address for card checkout", async () => {
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    const response = await POST(
      new Request("http://store.localhost:3000/api/customer/orders", {
        method: "POST",
        headers: {
          host: "store.localhost:3000",
          origin: "http://store.localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
          items: [{ productId: product.id, quantity: 1 }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_cart" });
    expect(getPlatformStore).not.toHaveBeenCalled();
  });

  it("adds configured flat shipping to the server-priced order total", async () => {
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn().mockResolvedValue({
        order: makeOrder({ total: 2700, shippingAmount: 200 }),
        created: true,
      }),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
      prepareCustomerOrderPayment: vi.fn().mockResolvedValue({
        order: makeOrder({
          total: 2700,
          shippingAmount: 200,
          paymentAttempt: 1,
        }),
        attempt: 1,
      }),
      saveCustomerOrderPaymentSession: vi
        .fn()
        .mockResolvedValue(
          makeOrder({ total: 2700, shippingAmount: 200, paymentAttempt: 1 }),
        ),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(
      withShippingSettings(store, "USD", { flatRate: 200 }),
    );
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(product),
    });
    createStripeCheckoutSession.mockResolvedValue({
      id: "cs_test_example",
      url: checkoutUrl,
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(store.createCustomerOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        subtotal: 2500,
        shippingAmount: 200,
        total: 2700,
      }),
    );
    expect(createStripeCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          subtotal: 2500,
          shippingAmount: 200,
          total: 2700,
        }),
      }),
    );
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
    getPlatformStore.mockReturnValue(withShippingSettings(store));
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

  it("validates and snapshots selected options while pricing from the catalog", async () => {
    const variantProduct = {
      ...product,
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { selections: { Size: "S" }, stock: 5 },
        { selections: { Size: "M" }, stock: 4 },
      ],
    };
    const order = makeOrder({
      items: [
        {
          productId: variantProduct.id,
          title: variantProduct.title,
          slug: variantProduct.slug,
          quantity: 1,
          variantSelections: { Size: "M" },
          unitPrice: variantProduct.price.amount,
          currency: variantProduct.price.currency,
        },
      ],
      total: variantProduct.price.amount,
      subtotal: variantProduct.price.amount,
      itemCount: 1,
    });
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn().mockResolvedValue({ order, created: true }),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
      prepareCustomerOrderPayment: vi.fn().mockResolvedValue({
        order: { ...order, paymentAttempt: 1 },
        attempt: 1,
      }),
      saveCustomerOrderPaymentSession: vi.fn().mockResolvedValue(order),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(withShippingSettings(store));
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(variantProduct),
      reserveInventory: vi.fn().mockResolvedValue(true),
    });
    createStripeCheckoutSession.mockResolvedValue({
      id: "cs_test_example",
      url: checkoutUrl,
    });

    const response = await POST(
      checkoutRequest([
        {
          productId: product.id,
          quantity: 1,
          variantSelections: { Size: "M" },
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(store.createCustomerOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        total: product.price.amount,
        items: [
          expect.objectContaining({
            variantSelections: { Size: "M" },
            inventoryTracked: true,
            unitPrice: product.price.amount,
          }),
        ],
      }),
    );
    expect(createTenantCatalogAdapter).toHaveBeenCalled();
    expect(
      (await createTenantCatalogAdapter.mock.results[0].value).reserveInventory,
    ).toHaveBeenCalledWith({
      reservationId: `${orderId}-1`,
      items: [
        {
          productId: product.id,
          selections: { Size: "M" },
          quantity: 1,
        },
      ],
    });
  });

  it("rejects invalid option selections before creating an order", async () => {
    const variantProduct = {
      ...product,
      options: [{ name: "Size", values: ["S", "M"] }],
    };
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn(),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });

    getPlatformStore.mockReturnValue(withShippingSettings(store));
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(variantProduct),
    });

    const response = await POST(
      checkoutRequest([
        {
          productId: product.id,
          quantity: 1,
          variantSelections: { Size: "XL" },
        },
      ]),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_changed" });
    expect(store.createCustomerOrder).not.toHaveBeenCalled();
  });

  it("rejects checkout when the atomic stock reservation fails", async () => {
    const variantProduct = {
      ...product,
      options: [{ name: "Size", values: ["S"] }],
      variants: [{ selections: { Size: "S" }, stock: 1 }],
    };
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn(),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(withShippingSettings(store));
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(variantProduct),
      reserveInventory: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(
      checkoutRequest([
        {
          productId: product.id,
          quantity: 1,
          variantSelections: { Size: "S" },
        },
      ]),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "insufficient_stock" });
    expect(store.createCustomerOrder).not.toHaveBeenCalled();
  });

  it("returns a local demo checkout link when demo mode is enabled", async () => {
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
        paymentSessionId: "demo_1_test",
      }),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(withShippingSettings(store));
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(product),
    });
    isLocalDemoCheckoutEnabled.mockReturnValue(true);
    createDemoCheckoutSessionId.mockReturnValue("demo_1_test");
    isDemoCheckoutSession.mockImplementation((sessionId: string) =>
      sessionId.startsWith("demo_"),
    );

    const response = await POST(checkoutRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkoutUrl).toBe(
      `http://store.localhost:3000/en/checkout/demo?orderId=${encodeURIComponent(orderId)}`,
    );
    expect(body.order).toMatchObject({
      paymentStatus: "pending",
      paymentSessionId: "demo_1_test",
    });
    expect(store.saveCustomerOrderPaymentSession).toHaveBeenCalledWith({
      tenantId,
      customerId,
      orderId,
      attempt: 1,
      sessionId: "demo_1_test",
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

  it("creates and syncs an unpaid INR cash-on-delivery order without Stripe", async () => {
    const codProduct = {
      ...product,
      price: { amount: 1250, currency: "INR" },
    };
    const order = makeOrder({
      currency: "INR",
      items: [
        {
          productId: product.id,
          title: product.title,
          slug: product.slug,
          quantity: 2,
          unitPrice: 1250,
          currency: "INR",
        },
      ],
      paymentMethod: "cash_on_delivery",
      paymentStatus: "cod_due",
      deliveryAddress: {
        fullName: "Test Customer",
        line1: "1 Market Road",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "IN",
        phone: "+919876543210",
      },
      backendSyncStatus: "pending",
    });
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getCustomerOrder: vi.fn().mockResolvedValue(null),
      createCustomerOrder: vi.fn().mockResolvedValue({ order, created: true }),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    };
    getCustomerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue(withShippingSettings(store, "INR"));
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(codProduct),
    });
    syncCustomerOrderToTenant.mockResolvedValue(order);

    const response = await POST(cashOnDeliveryRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      order: {
        paymentMethod: "cash_on_delivery",
        paymentStatus: "cod_due",
        currency: "INR",
        deliveryAddress: { country: "IN", phone: "+919876543210" },
      },
      cashOnDelivery: true,
    });
    expect(syncCustomerOrderToTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        hostId,
        order: expect.objectContaining({
          paymentMethod: "cash_on_delivery",
          paymentStatus: "cod_due",
        }),
      }),
    );
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });
});
