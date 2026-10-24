import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/ports/data";
import { RestBackendError, RestCatalogAdapter } from "./catalog-adapter";
import type { RestHttpResponse } from "./safe-http";

const tenantId = "tenant-1";
const config = {
  type: "rest" as const,
  baseUrl: "https://api.example.com",
  apiVersion: "v1",
  authMode: "apiKey" as const,
  apiKeyRef: "api-key-ref",
};
const now = "2026-10-20T00:00:00.000Z";
const product: Product = {
  id: "product-1",
  tenantId,
  title: "Canvas bag",
  slug: "canvas-bag",
  status: "active",
  price: { amount: 1999, currency: "USD" },
  sku: "BAG-1",
  imageUrl: "https://cdn.example.com/tenant/product.jpg",
  createdAt: now,
  updatedAt: now,
};

function mockTransport(body: unknown, status = 200) {
  const transport = vi.fn(async (): Promise<RestHttpResponse> => ({
    status,
    body,
  }));
  return transport;
}

describe("RestCatalogAdapter", () => {
  it("lists tenant products with versioned-contract pagination and validates response", async () => {
    const transport = mockTransport({
      data: [product],
      meta: { page: 2, limit: 10, total: 13 },
    });
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      transport,
    );

    await expect(
      adapter.listProducts({ tenantId, page: 2, limit: 10 }),
    ).resolves.toEqual({
      data: [product],
      meta: { page: 2, limit: 10, total: 13 },
    });
    expect(transport).toHaveBeenCalledWith(
      config,
      "secret",
      expect.objectContaining({
        method: "GET",
        path: "/products",
        query: new URLSearchParams({
          page: "2",
          limit: "10",
          tenantId,
        }),
      }),
    );
  });

  it("performs product read, create, update, and delete requests", async () => {
    const transport = mockTransport(product, 200);
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      transport,
    );

    await expect(adapter.getProduct(tenantId, product.id)).resolves.toEqual(
      product,
    );
    expect(transport).toHaveBeenLastCalledWith(
      config,
      "secret",
      expect.objectContaining({
        method: "GET",
        path: "/products/product-1",
      }),
    );

    await expect(
      adapter.createProduct({
        tenantId,
        title: product.title,
        slug: product.slug,
        status: product.status,
        price: product.price,
        sku: product.sku,
        imageUrl: product.imageUrl,
      }),
    ).resolves.toEqual(product);
    expect(transport).toHaveBeenLastCalledWith(
      config,
      "secret",
      expect.objectContaining({
        method: "POST",
        path: "/products",
        body: expect.objectContaining({
          tenantId,
          imageUrl: product.imageUrl,
        }),
      }),
    );

    await expect(
      adapter.updateProduct(tenantId, product.id, {
        title: "Updated bag",
        imageUrl: null,
      }),
    ).resolves.toEqual(product);
    expect(transport).toHaveBeenLastCalledWith(
      config,
      "secret",
      expect.objectContaining({
        method: "PATCH",
        path: "/products/product-1",
        body: { title: "Updated bag", imageUrl: null },
      }),
    );

    transport.mockResolvedValueOnce({ status: 204, body: null });
    await expect(
      adapter.deleteProduct(tenantId, product.id),
    ).resolves.toBeUndefined();
    expect(transport).toHaveBeenLastCalledWith(
      config,
      "secret",
      expect.objectContaining({
        method: "DELETE",
        path: "/products/product-1",
      }),
    );
  });

  it("rejects cross-tenant access, invalid pagination, and unsafe product IDs", async () => {
    const transport = mockTransport(product);
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      transport,
    );

    await expect(
      adapter.listProducts({ tenantId: "other-tenant", page: 1, limit: 20 }),
    ).rejects.toThrow("outside the configured tenant scope");
    await expect(
      adapter.getProduct("other-tenant", product.id),
    ).rejects.toThrow("outside the configured tenant scope");
    await expect(
      adapter.listProducts({ tenantId, page: 1, limit: 101 }),
    ).rejects.toThrow("Product pagination");
    await expect(adapter.getProduct(tenantId, "../secrets")).rejects.toThrow(
      "unsupported characters",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects backend responses containing another tenant's product", async () => {
    const transport = mockTransport({
      ...product,
      tenantId: "other-tenant",
    });
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      transport,
    );

    await expect(adapter.getProduct(tenantId, product.id)).rejects.toThrow(
      "outside the configured tenant scope",
    );
  });

  it.each([
    [401, "rejected the configured API key"],
    [404, "Product was not found"],
    [429, "rate limit was exceeded"],
    [503, "encountered an error"],
  ])(
    "maps HTTP %s failures without leaking backend response data",
    async (status, message) => {
      const transport = mockTransport(
        {
          error: { message: "backend internal details", token: "secret-value" },
        },
        status,
      );
      const adapter = new RestCatalogAdapter(
        config,
        "secret",
        tenantId,
        transport,
      );

      await expect(adapter.getProduct(tenantId, product.id)).rejects.toThrow(
        message,
      );
      await expect(
        adapter.getProduct(tenantId, product.id),
      ).rejects.not.toThrow("secret-value");
    },
  );

  it("rejects malformed product payloads", async () => {
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      mockTransport({ ...product, price: { amount: -1, currency: "USD" } }),
    );

    await expect(adapter.getProduct(tenantId, product.id)).rejects.toThrow();
  });

  it("exposes structured HTTP status errors", async () => {
    const adapter = new RestCatalogAdapter(
      config,
      "secret",
      tenantId,
      mockTransport({}, 409),
    );

    await expect(
      adapter.getProduct(tenantId, product.id),
    ).rejects.toMatchObject({
      name: "RestBackendError",
      status: 409,
    } satisfies Partial<RestBackendError>);
  });
});
