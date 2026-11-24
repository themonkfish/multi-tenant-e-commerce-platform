import { describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag,
  unstable_cache: (read: () => unknown, keyParts: string[], options: unknown) =>
    Object.assign(() => read(), { keyParts, options }),
}));

vi.mock("server-only", () => ({}));

import {
  cachedTenantCatalogRead,
  cachedTenantSettingsRead,
  invalidateTenantCatalogCache,
  invalidateTenantSettingsCache,
  tenantCatalogCacheTag,
  tenantSettingsCacheTag,
} from "./tenant-cache";

describe("tenant-aware cache keys", () => {
  it("uses separate host, tenant, locale, and operation cache keys", () => {
    const catalog = cachedTenantCatalogRead(
      "host-1",
      "tenant-1",
      "en",
      "catalog-list:1::",
      async () => ["product"],
    ) as unknown as {
      keyParts: string[];
      options: { tags: string[]; revalidate: number };
    };
    expect(catalog.keyParts).toEqual([
      "tenant-catalog",
      "host-1",
      "tenant-1",
      "en",
      "catalog-list:1::",
    ]);
    expect(catalog.options.tags).toContain(
      "tenant:host-1:tenant-1:catalog",
    );

    const settings = cachedTenantSettingsRead(
      "host-1",
      "tenant-1",
      "fr",
      async () => ({ name: "Store" }),
    ) as unknown as { keyParts: string[] };
    expect(settings.keyParts).toEqual([
      "tenant-settings",
      "host-1",
      "tenant-1",
      "fr",
    ]);
  });

  it("invalidates only the tenant catalog or settings tag", () => {
    invalidateTenantCatalogCache("host-1", "tenant-1");
    expect(revalidateTag).toHaveBeenCalledWith(
      tenantCatalogCacheTag("host-1", "tenant-1"),
      "max",
    );

    invalidateTenantSettingsCache("host-1", "tenant-1");
    expect(revalidateTag).toHaveBeenCalledWith(
      tenantSettingsCacheTag("host-1", "tenant-1"),
      "max",
    );
  });
});
