import "server-only";
import { createRestCatalogAdapter } from "./catalog-adapter";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";

export async function createTenantCatalogAdapter(
  tenantId: string,
  hostId: string,
) {
  const store = getPlatformStore();
  const [hosts, tenants] = await Promise.all([
    store.listHosts(),
    store.listTenantsForHost(hostId),
  ]);
  const hostIsActive = hosts.some(
    (candidate) => candidate.id === hostId && candidate.status === "active",
  );
  const tenant = tenants.find(
    (candidate) =>
      candidate.id === tenantId &&
      candidate.hostId === hostId &&
      candidate.status === "active",
  );
  if (!hostIsActive || !tenant) {
    throw new Error("Active tenant was not found in the requested host scope");
  }

  const config = await store.getTenantRestConnection(tenantId, hostId);
  if (!config) {
    throw new Error("Tenant REST backend is not configured");
  }
  const apiKey = await getSecretVault().getSecret(config.apiKeyRef);
  return createRestCatalogAdapter(config, apiKey, tenantId);
}
