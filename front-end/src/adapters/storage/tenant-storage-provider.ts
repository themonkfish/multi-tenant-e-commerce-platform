import "server-only";
import { z } from "zod";
import { TenantS3StorageAdapter } from "./s3/tenant-s3-storage";
import { TenantSupabaseStorageAdapter } from "./supabase/tenant-supabase-storage";
import { TenantGcsStorageAdapter } from "./gcs/tenant-gcs-storage";
import { TenantAzureStorageAdapter } from "./azure/tenant-azure-storage";
import { TenantCloudinaryStorageAdapter } from "./cloudinary/tenant-cloudinary-storage";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";

const S3CredentialsSchema = z
  .object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    sessionToken: z.string().min(1).optional(),
  })
  .strict();

const SupabaseStorageCredentialsSchema = z
  .object({ serviceKey: z.string().min(1) })
  .strict();
const GcsStorageCredentialsSchema = z
  .object({
    client_email: z.string().email(),
    private_key: z.string().min(1),
    token_uri: z.string().url().optional(),
  })
  .strict();
const AzureStorageCredentialsSchema = z
  .object({
    accountName: z.string().min(3).max(24),
    accountKey: z.string().min(16),
  })
  .strict();
const CloudinaryStorageCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
  })
  .strict();

export async function createTenantStorageAdapter(
  tenantId: string,
  hostId: string,
): Promise<
  | TenantS3StorageAdapter
  | TenantSupabaseStorageAdapter
  | TenantGcsStorageAdapter
  | TenantAzureStorageAdapter
  | TenantCloudinaryStorageAdapter
> {
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
  const secret = JSON.parse(
    await getSecretVault().getSecret(config.credentialsRef),
  );
  if (config.type === "supabase") {
    const credentials = SupabaseStorageCredentialsSchema.parse(secret);
    return new TenantSupabaseStorageAdapter(config, tenantId, credentials);
  }
  if (config.type === "gcs") {
    const credentials = GcsStorageCredentialsSchema.parse(secret);
    return new TenantGcsStorageAdapter(config, tenantId, credentials);
  }
  if (config.type === "azure") {
    const credentials = AzureStorageCredentialsSchema.parse(secret);
    if (credentials.accountName !== config.accountName) {
      throw new Error("Azure Blob account name does not match storage configuration");
    }
    return new TenantAzureStorageAdapter(config, tenantId, credentials);
  }
  if (config.type === "cloudinary") {
    const credentials = CloudinaryStorageCredentialsSchema.parse(secret);
    return new TenantCloudinaryStorageAdapter(config, tenantId, credentials);
  }
  const credentials = S3CredentialsSchema.parse(secret);
  return new TenantS3StorageAdapter(config, tenantId, credentials);
}
