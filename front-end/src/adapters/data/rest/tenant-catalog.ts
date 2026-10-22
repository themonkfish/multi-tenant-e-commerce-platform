import "server-only";
import { createRestCatalogAdapter } from "./catalog-adapter";
import { getTenantRestCredentials } from "./tenant-rest-credentials";

export async function createTenantCatalogAdapter(
  tenantId: string,
  hostId: string,
) {
  const { config, apiKey } = await getTenantRestCredentials(tenantId, hostId);
  return createRestCatalogAdapter(config, apiKey, tenantId);
}
