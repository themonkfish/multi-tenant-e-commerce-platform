import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";

export function tenantCacheTag(hostId: string, tenantId: string, area = "catalog") {
  return `tenant:${hostId}:${tenantId}:${area}`;
}

export function tenantCatalogCacheTag(hostId: string, tenantId: string) {
  return tenantCacheTag(hostId, tenantId, "catalog");
}

export function tenantSettingsCacheTag(hostId: string, tenantId: string) {
  return tenantCacheTag(hostId, tenantId, "settings");
}

export function invalidateTenantCatalogCache(hostId: string, tenantId: string) {
  revalidateTag(tenantCatalogCacheTag(hostId, tenantId), "max");
}

export function invalidateTenantSettingsCache(hostId: string, tenantId: string) {
  revalidateTag(tenantSettingsCacheTag(hostId, tenantId), "max");
}

export function cachedTenantCatalogRead<T>(
  hostId: string,
  tenantId: string,
  locale: string,
  operation: string,
  read: () => Promise<T>,
) {
  return unstable_cache(read, [
    "tenant-catalog",
    hostId,
    tenantId,
    locale,
    operation,
  ], {
    revalidate: 60,
    tags: [
      tenantCatalogCacheTag(hostId, tenantId),
      `tenant:${hostId}:${tenantId}`,
    ],
  });
}

export function cachedTenantSettingsRead<T>(
  hostId: string,
  tenantId: string,
  locale: string,
  read: () => Promise<T>,
) {
  return unstable_cache(read, [
    "tenant-settings",
    hostId,
    tenantId,
    locale,
  ], {
    revalidate: 60,
    tags: [
      tenantSettingsCacheTag(hostId, tenantId),
      `tenant:${hostId}:${tenantId}`,
    ],
  });
}
