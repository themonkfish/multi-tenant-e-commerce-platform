import "server-only";
import { z } from "zod";
import { TenantS3StorageAdapter } from "./s3/tenant-s3-storage";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";

const S3CredentialsSchema = z
  .object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    sessionToken: z.string().min(1).optional(),
  })
  .strict();

export async function createTenantStorageAdapter(
  tenantId: string,
  hostId: string,
): Promise<TenantS3StorageAdapter> {
  const store = getPlatformStore();
  const [hosts, tenants, config] = await Promise.all([
    store.listHosts(),
    store.listTenantsForHost(hostId),
    store.getTenantStorageProvider(tenantId, hostId),
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
  if (!config) {
    throw new Error("Tenant storage provider is not configured");
  }
  const credentials = S3CredentialsSchema.parse(
    JSON.parse(await getSecretVault().getSecret(config.credentialsRef)),
  );
  return new TenantS3StorageAdapter(config, tenantId, credentials);
}
