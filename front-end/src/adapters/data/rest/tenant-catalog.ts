import "server-only";
import { createRestCatalogAdapter } from "./catalog-adapter";
import { getTenantRestCredentials } from "./tenant-rest-credentials";
import { createTenantDatabaseAdapter } from "../database/tenant-provider-factory";
import { getPlatformStore } from "@/lib/server/platform";
import { TenantDataBackendError } from "@/core/ports/data";
import { TENANT_CATALOG_SCHEMA_VERSION } from "../database/tenant-database-adapter";

export async function createTenantCatalogAdapter(
  tenantId: string,
  hostId: string,
) {
  const databaseConfig = await getPlatformStore().getTenantDatabaseProvider(
    tenantId,
    hostId,
  );
  if (databaseConfig) {
    const adapter = await createTenantDatabaseAdapter(tenantId, hostId);
    const schemaVersion = await adapter.getSchemaVersion();
    if (schemaVersion !== TENANT_CATALOG_SCHEMA_VERSION) {
      throw new TenantDataBackendError(
        409,
        schemaVersion === null
          ? "Tenant database schema is not initialized"
          : "Tenant database schema upgrade is required",
      );
    }
    return adapter.catalog;
  }
  const { config, apiKey } = await getTenantRestCredentials(tenantId, hostId);
  return createRestCatalogAdapter(config, apiKey, tenantId);
}
