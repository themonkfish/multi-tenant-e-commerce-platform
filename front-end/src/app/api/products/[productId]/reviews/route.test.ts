import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const customerSession = vi.hoisted(() => vi.fn());
const requestScope = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());
const isSameOrigin = vi.hoisted(() => vi.fn());
const createRateLimitKey = vi.hoisted(() => vi.fn());
const createTenantCatalogAdapter = vi.hoisted(() => vi.fn());

vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/session", () => ({
  getCustomerSession: customerSession,
}));
vi.mock("@/lib/server/request-scope", () => ({
  getRequestDomainScope: requestScope,
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));
vi.mock("@/lib/server/http", () => ({
  isSameOrigin,
  createRateLimitKey,
}));

const tenantId = "550e8400-e29b-41d4-a716-446655440002";
const customerId = "550e8400-e29b-41d4-a716-446655440003";
const hostId = "550e8400-e29b-41d4-a716-446655440004";

function reviewRequest() {
  return new Request(
    "https://store.example.com/api/products/product-1/reviews",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productId: "product-1",
        rating: 5,
        title: "Excellent",
        body: "A useful product.",
      }),
    },
  );
}

describe("product review routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSameOrigin.mockReturnValue(true);
    createRateLimitKey.mockReturnValue("test-rate-limit-key");
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue({ status: "active" }),
    });
  });

  it("lists public tenant-scoped reviews", async () => {
    requestScope.mockResolvedValue({
      kind: "tenant",
      tenant: { id: tenantId },
      host: { id: hostId },
    });
    store.mockReturnValue({
      listProductReviews: vi.fn().mockResolvedValue([]),
    });
    const response = await GET(
      new Request("https://store.example.com/api/products/product-1/reviews"),
      { params: Promise.resolve({ productId: "product-1" }) },
    );
    expect(response.status).toBe(200);
    expect(createTenantCatalogAdapter).toHaveBeenCalledWith(tenantId, hostId);
  });

  it("does not list reviews for inactive products", async () => {
    requestScope.mockResolvedValue({
      kind: "tenant",
      tenant: { id: tenantId },
      host: { id: hostId },
    });
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue({ status: "draft" }),
    });
    const listProductReviews = vi.fn();
    store.mockReturnValue({ listProductReviews });

    const response = await GET(
      new Request("https://store.example.com/api/products/product-1/reviews"),
      { params: Promise.resolve({ productId: "product-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "product_unavailable" });
    expect(listProductReviews).not.toHaveBeenCalled();
  });

  it("requires Customer authentication for review submission", async () => {
    customerSession.mockResolvedValue(null);
    const response = await POST(reviewRequest(), {
      params: Promise.resolve({ productId: "product-1" }),
    });
    expect(response.status).toBe(401);
  });

  it("requires a paid order containing the reviewed product", async () => {
    customerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    const listCustomerOrders = vi.fn().mockResolvedValue([
      {
        paymentStatus: "pending",
        items: [{ productId: "product-1" }],
      },
      {
        paymentStatus: "paid",
        items: [{ productId: "another-product" }],
      },
    ]);
    const createProductReview = vi.fn();
    store.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listCustomerOrders,
      createProductReview,
    });

    const response = await POST(reviewRequest(), {
      params: Promise.resolve({ productId: "product-1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "purchase_required" });
    expect(listCustomerOrders).toHaveBeenCalledWith(tenantId, customerId);
    expect(createProductReview).not.toHaveBeenCalled();
  });

  it("rejects reviews for inactive products", async () => {
    customerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue({ status: "archived" }),
    });
    const listCustomerOrders = vi.fn();
    const createProductReview = vi.fn();
    store.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listCustomerOrders,
      createProductReview,
    });

    const response = await POST(reviewRequest(), {
      params: Promise.resolve({ productId: "product-1" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "product_unavailable" });
    expect(listCustomerOrders).not.toHaveBeenCalled();
    expect(createProductReview).not.toHaveBeenCalled();
  });

  it("accepts a review when a paid tenant order contains the product", async () => {
    customerSession.mockResolvedValue({
      userId: customerId,
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    const savedReview = {
      id: "review-1",
      tenantId,
      productId: "product-1",
      customerId,
      rating: 5,
      title: "Excellent",
      body: "A useful product.",
      createdAt: "2026-11-19T00:00:00.000Z",
    };
    const createProductReview = vi.fn().mockResolvedValue(savedReview);
    store.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listCustomerOrders: vi.fn().mockResolvedValue([
        {
          paymentStatus: "paid",
          items: [{ productId: "product-1" }],
        },
      ]),
      createProductReview,
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });

    const response = await POST(reviewRequest(), {
      params: Promise.resolve({ productId: "product-1" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ review: savedReview });
    expect(createProductReview).toHaveBeenCalledOnce();
  });
});
