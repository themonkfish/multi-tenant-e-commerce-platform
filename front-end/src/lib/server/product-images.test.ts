import { describe, expect, it } from "vitest";
import {
  getTenantUploadedImageKey,
  validateTenantUploadedImageUrl,
} from "./product-images";
import type { StoragePort } from "@/core/ports/storage";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`;

describe("tenant product images", () => {
  it("extracts only tenant-scoped uploaded image keys", () => {
    expect(
      getTenantUploadedImageKey(
        tenantId,
        `https://cdn.example.com/assets/${key}`,
      ),
    ).toBe(key);
    expect(
      getTenantUploadedImageKey(
        tenantId,
        "https://cdn.example.com/external/product.png",
      ),
    ).toBeNull();
  });

  it("requires an uploaded URL to match the configured public base", () => {
    const storage = {
      getPublicUrl: () => `https://cdn.example.com/assets/${key}`,
    } as unknown as StoragePort;

    expect(
      validateTenantUploadedImageUrl(
        storage,
        tenantId,
        `https://cdn.example.com/assets/${key}`,
      ),
    ).toBe(key);
    expect(() =>
      validateTenantUploadedImageUrl(
        storage,
        tenantId,
        `https://wrong.example.com/assets/${key}`,
      ),
    ).toThrow("Product image does not belong");
  });
});
