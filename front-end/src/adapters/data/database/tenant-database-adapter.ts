import type { CatalogPort } from "@/core/ports/data";

export const TENANT_CATALOG_SCHEMA_VERSION = 6;

export interface TenantDatabaseAdapter {
  catalog: CatalogPort;
  checkConnection(): Promise<number | null>;
  initializeSchema(): Promise<number>;
  getSchemaVersion(): Promise<number | null>;
}

export type TenantDatabaseSchemaStatus =
  "not_initialized" | "current" | "upgrade_available" | "upgrade_required";

export function classifyTenantDatabaseSchema(
  schemaVersion: number | null,
): TenantDatabaseSchemaStatus {
  if (schemaVersion === null) return "not_initialized";
  if (schemaVersion === TENANT_CATALOG_SCHEMA_VERSION) return "current";
  return schemaVersion < TENANT_CATALOG_SCHEMA_VERSION
    ? "upgrade_available"
    : "upgrade_required";
}
