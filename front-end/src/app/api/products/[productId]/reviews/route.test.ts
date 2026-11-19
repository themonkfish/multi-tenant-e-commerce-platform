import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const customerSession = vi.hoisted(() => vi.fn());
const requestScope = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/session", () => ({
  getCustomerSession: customerSession,
}));
vi.mock("@/lib/server/request-scope", () => ({
  getRequestDomainScope: requestScope,
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));

describe("product review routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists public tenant-scoped reviews", async () => {
    requestScope.mockResolvedValue({
      kind: "tenant",
      tenant: { id: "550e8400-e29b-41d4-a716-446655440002" },
    });
    store.mockReturnValue({
      listProductReviews: vi.fn().mockResolvedValue([]),
    });
    const response = await GET(
      new Request("https://store.example.com/api/products/product-1/reviews"),
      { params: Promise.resolve({ productId: "product-1" }) },
    );
    expect(response.status).toBe(200);
  });

  it("requires Customer authentication for review submission", async () => {
    customerSession.mockResolvedValue(null);
    const response = await POST(
      new Request("https://store.example.com/api/products/product-1/reviews", {
        method: "POST",
        headers: {
          origin: "https://store.example.com",
          host: "store.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          productId: "product-1",
          rating: 5,
          title: "Excellent",
          body: "A useful product.",
        }),
      }),
      { params: Promise.resolve({ productId: "product-1" }) },
    );
    expect(response.status).toBe(401);
  });
});
