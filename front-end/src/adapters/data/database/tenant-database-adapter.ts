import type { CatalogPort } from "@/core/ports/data";

export const TENANT_CATALOG_SCHEMA_VERSION = 2;

export interface TenantDatabaseAdapter {
  catalog: CatalogPort;
  checkConnection(): Promise<number | null>;
  initializeSchema(): Promise<number>;
  getSchemaVersion(): Promise<number | null>;
}
