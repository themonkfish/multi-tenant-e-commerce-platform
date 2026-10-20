import { z } from "zod";

const SecretRefSchema = z.string().min(1);

export const DataProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rest"),
    baseUrl: z.url(),
    apiVersion: z.string().min(1),
    authMode: z.enum(["apiKey", "oauth2", "jwt"]),
  }),
  z.object({
    type: z.literal("supabase"),
    projectUrl: z.url(),
    anonKeyRef: SecretRefSchema.optional(),
    serviceKeyRef: SecretRefSchema,
    schema: z.string().min(1).optional(),
    tenancyMode: z.enum(["dedicated-project", "shared-rls"]),
  }),
  z.object({
    type: z.literal("mongodb"),
    connectionRef: SecretRefSchema,
    dbName: z.string().min(1),
    tenancyMode: z.enum(["dedicated-db", "shared-collection-tenantId"]),
  }),
]);

export const StorageProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("s3"),
    endpoint: z.url().optional(),
    region: z.string().min(1),
    bucket: z.string().min(1),
    credentialsRef: SecretRefSchema,
    publicBaseUrl: z.url(),
    pathStyle: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("gcs"),
    bucket: z.string().min(1),
    credentialsRef: SecretRefSchema,
    publicBaseUrl: z.url(),
  }),
  z.object({
    type: z.literal("azure"),
    container: z.string().min(1),
    credentialsRef: SecretRefSchema,
    publicBaseUrl: z.url(),
  }),
  z.object({
    type: z.literal("cloudinary"),
    cloudName: z.string().min(1),
    credentialsRef: SecretRefSchema,
  }),
  z.object({
    type: z.literal("supabase"),
    bucket: z.string().min(1),
    credentialsRef: SecretRefSchema,
  }),
  z.object({
    type: z.enum(["gdrive", "dropbox", "onedrive"]),
    folderId: z.string().min(1),
    oauthTokenRef: SecretRefSchema,
    accountEmail: z.email(),
  }),
  z.object({
    type: z.literal("custom"),
    uploadUrl: z.url(),
    credentialsRef: SecretRefSchema,
    publicBaseUrl: z.url().optional(),
  }),
]);

export const TenantConfigSchema = z.object({
  id: z.string().min(1),
  hostId: z.string().min(1),
  slug: z.string().min(1),
  domains: z.array(z.string().min(1)),
  status: z.enum(["pending", "active", "suspended"]),
  plan: z.string().min(1),
  locale: z.object({
    defaultLocale: z.string().min(2),
    locales: z.array(z.string().min(2)).min(1),
    currency: z.string().length(3),
    currencies: z.array(z.string().length(3)).min(1),
  }),
  data: DataProviderConfigSchema,
  storage: StorageProviderConfigSchema,
  payments: z.array(
    z.object({
      gateway: z.string().min(1),
      enabled: z.boolean(),
      mode: z.enum(["test", "live"]),
      priority: z.number().int(),
      publicConfig: z.record(z.string(), z.string()),
      currencies: z.array(z.string().length(3)),
      countries: z.array(z.string().length(2)).optional(),
    }),
  ),
  features: z.record(z.string(), z.boolean()),
});

export type DataProviderConfig = z.infer<typeof DataProviderConfigSchema>;
export type StorageProviderConfig = z.infer<typeof StorageProviderConfigSchema>;
export type TenantConfig = z.infer<typeof TenantConfigSchema>;
