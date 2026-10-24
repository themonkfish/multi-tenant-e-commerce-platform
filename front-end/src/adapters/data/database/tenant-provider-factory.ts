import "server-only";
import { createMongoTenantDatabaseAdapter } from "@/adapters/data/mongodb/tenant-catalog";
import { createSupabaseTenantDatabaseAdapter } from "@/adapters/data/supabase/tenant-catalog";
import type { TenantDatabaseAdapter } from "./tenant-database-adapter";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";

export async function createTenantDatabaseAdapter(
  tenantId: string,
  hostId: string,
): Promise<TenantDatabaseAdapter> {
  const store = getPlatformStore();
  const config = await store.getTenantDatabaseProvider(tenantId, hostId);
  if (!config) {
    throw new Error("Tenant database provider is not configured");
  }
  const secretRef =
    config.type === "supabase" ? config.serviceKeyRef : config.connectionRef;
  const secret = await getSecretVault().getSecret(secretRef);
  return config.type === "supabase"
    ? createSupabaseTenantDatabaseAdapter(config, secret, tenantId)
    : createMongoTenantDatabaseAdapter(config, secret, tenantId);
}
