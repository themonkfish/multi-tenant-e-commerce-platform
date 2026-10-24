import { describe, expect, it, vi } from "vitest";
import type { CatalogPort } from "@/core/ports/data";
import { createDataAdapterFactory } from "./factory";

const catalogAdapter: CatalogPort = {
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  listProductCategories: vi.fn(),
  reserveInventory: vi.fn(),
  releaseInventory: vi.fn(),
  commitInventory: vi.fn(),
};

describe("createDataAdapterFactory", () => {
  it("returns an adapter registered for the selected provider", () => {
    const factory = createDataAdapterFactory({ rest: catalogAdapter });

    expect(
      factory({
        type: "rest",
        baseUrl: "https://tenant.example",
        apiVersion: "v1",
        authMode: "jwt",
      }),
    ).toBe(catalogAdapter);
  });

  it("fails explicitly when a provider is not registered", () => {
    const factory = createDataAdapterFactory({});

    expect(() =>
      factory({
        type: "mongodb",
        connectionRef: "secret-ref",
        dbName: "store",
        tenancyMode: "dedicated-db",
      }),
    ).toThrow('Data adapter "mongodb" is not configured');
  });
});
