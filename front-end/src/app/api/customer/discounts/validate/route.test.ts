import { describe, expect, it, vi } from "vitest";

const { getCustomerSession, getPlatformStore, createTenantCatalogAdapter } =
  vi.hoisted(() => ({
    getCustomerSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createTenantCatalogAdapter: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getCustomerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter,
}));
vi.mock("@/lib/server/http", () => ({
  isSameOrigin: vi.fn().mockReturnValue(true),
  createRateLimitKey: vi.fn().mockReturnValue("test-rate-limit-key"),
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const product = {
  id: "product-1",
  tenantId,
  title: "Canvas Bag",
  slug: "canvas-bag",
  status: "active",
  price: { amount: 1250, currency: "USD" },
  variantPricing: [{ selections: { Size: "M" }, amount: 1500 }],
  options: [{ name: "Size", values: ["S", "M"] }],
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
};

function validationRequest(code: string, variantSelections?: object) {
  return new Request(
    "http://store.localhost:3000/api/customer/discounts/validate",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code,
        items: [
          {
            productId: product.id,
            quantity: 2,
            ...(variantSelections ? { variantSelections } : {}),
          },
        ],
      }),
    },
  );
}

describe("POST /api/customer/discounts/validate", () => {
  it("validates a code against server-resolved variant pricing", async () => {
    getCustomerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440002",
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        locale: { currency: "USD" },
        discounts: [{ code: "SAVE10", type: "percentage", value: 10 }],
      }),
    });
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue(product),
    });

    const response = await POST(validationRequest("save10", { Size: "M" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "SAVE10",
      discountAmount: 300,
      subtotal: 3000,
    });
  });

  it("rejects fixed discounts when the cart currency differs from store default", async () => {
    getCustomerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440002",
      role: "customer",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["customer:orders:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        locale: { currency: "INR" },
        discounts: [{ code: "SAVE5", type: "fixed_amount", value: 500 }],
      }),
    });
    createTenantCatalogAdapter.mockResolvedValue({
      getProduct: vi.fn().mockResolvedValue({
        ...product,
        price: { amount: 1250, currency: "USD" },
        variantPricing: undefined,
      }),
    });

    const response = await POST(validationRequest("SAVE5", { Size: "S" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "discount_currency_unsupported",
    });
  });
});
