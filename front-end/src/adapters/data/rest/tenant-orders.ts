import "server-only";
import { createRestTenantOrderAdapter } from "./tenant-order-adapter";
import { getTenantRestCredentials } from "./tenant-rest-credentials";

export async function createTenantOrderAdapter(
  tenantId: string,
  hostId: string,
) {
  const { config, apiKey } = await getTenantRestCredentials(tenantId, hostId);
  return createRestTenantOrderAdapter(config, apiKey, tenantId);
}
