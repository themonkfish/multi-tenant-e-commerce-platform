import { z } from "zod";

const SecretRefSchema = z.string().min(1);

function isTenantSupabaseProjectUrl(value: string): boolean {
  const url = new URL(value);
  return (
    /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.port &&
    !url.username &&
    !url.password
  );
}

const restBaseFields = {
  type: z.literal("rest"),
  baseUrl: z.url({ protocol: /^https?$/ }),
  apiVersion: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
};

export const RestDataProviderConfigSchema = z.object({
  ...restBaseFields,
  authMode: z.enum(["apiKey", "oauth2", "jwt"]),
  apiKeyRef: SecretRefSchema.optional(),
});

export const TenantRestDataProviderConfigSchema = z.object({
  ...restBaseFields,
  authMode: z.literal("apiKey"),
  apiKeyRef: SecretRefSchema,
});

export const TenantRestConnectionInputSchema = z.object({
  baseUrl: z.url({ protocol: /^https?$/ }),
  apiVersion: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  apiKey: z
    .string()
    .max(2048)
    .refine(
      (value) => !/[\x00-\x1f\x7f]/.test(value),
      "API key contains invalid characters",
    )
    .optional(),
});

export const TenantRestConnectionViewSchema = z.object({
  baseUrl: z.string(),
  apiVersion: z.string(),
  apiKeyConfigured: z.boolean(),
});

export const TenantSupabaseConnectionInputSchema = z.object({
  projectUrl: z.url({ protocol: /^https$/ }).refine(isTenantSupabaseProjectUrl),
  serviceKey: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
    .optional(),
  schema: z.literal("public").default("public"),
  tenancyMode: z.literal("dedicated-project").default("dedicated-project"),
});

export const TenantMongoConnectionInputSchema = z.object({
  connectionString: z.string().min(1).max(4096).optional(),
  dbName: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z0-9_-]+$/),
  tenancyMode: z.literal("dedicated-db").default("dedicated-db"),
});

export const TenantDatabaseConnectionInputSchema = z.discriminatedUnion(
  "type",
  [
    TenantSupabaseConnectionInputSchema.extend({
      type: z.literal("supabase"),
    }),
    TenantMongoConnectionInputSchema.extend({
      type: z.literal("mongodb"),
    }),
  ],
);

const TenantRestConnectionProviderViewSchema = z.object({
  type: z.literal("rest"),
  baseUrl: z.string(),
  apiVersion: z.string(),
  credentialConfigured: z.boolean(),
});

const TenantSupabaseConnectionViewSchema = z.object({
  type: z.literal("supabase"),
  projectUrl: z.string(),
  schema: z.string(),
  tenancyMode: z.literal("dedicated-project"),
  credentialConfigured: z.boolean(),
  schemaVersion: z.number().int().nonnegative().nullable(),
});

const TenantMongoConnectionViewSchema = z.object({
  type: z.literal("mongodb"),
  dbName: z.string(),
  tenancyMode: z.literal("dedicated-db"),
  credentialConfigured: z.boolean(),
  schemaVersion: z.number().int().nonnegative().nullable(),
});

export const TenantDataConnectionViewSchema = z.discriminatedUnion("type", [
  TenantRestConnectionProviderViewSchema,
  TenantSupabaseConnectionViewSchema,
  TenantMongoConnectionViewSchema,
]);

export const TenantDatabaseConnectionViewSchema = z.discriminatedUnion("type", [
  TenantSupabaseConnectionViewSchema,
  TenantMongoConnectionViewSchema,
]);

export const RestHealthCheckResultSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  latencyMs: z.number().int().nonnegative(),
  missing: z.array(z.string()),
  schemaVersion: z.string().optional(),
  error: z
    .enum(["blocked_target", "unreachable", "timeout", "invalid_response"])
    .optional(),
});

export const DataProviderConfigSchema = z.discriminatedUnion("type", [
  RestDataProviderConfigSchema,
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

export const TenantDatabaseProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("supabase"),
    projectUrl: z
      .url({ protocol: /^https$/ })
      .refine(isTenantSupabaseProjectUrl),
    serviceKeyRef: SecretRefSchema,
    schema: z.literal("public"),
    tenancyMode: z.literal("dedicated-project"),
  }),
  z.object({
    type: z.literal("mongodb"),
    connectionRef: SecretRefSchema,
    dbName: z.string().min(1).max(63),
    tenancyMode: z.literal("dedicated-db"),
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
export type RestDataProviderConfig = z.infer<
  typeof RestDataProviderConfigSchema
>;
export type TenantRestDataProviderConfig = z.infer<
  typeof TenantRestDataProviderConfigSchema
>;
export type TenantRestConnectionInput = z.infer<
  typeof TenantRestConnectionInputSchema
>;
export type TenantSupabaseConnectionInput = z.infer<
  typeof TenantSupabaseConnectionInputSchema
>;
export type TenantMongoConnectionInput = z.infer<
  typeof TenantMongoConnectionInputSchema
>;
export type TenantDatabaseProviderConfig = z.infer<
  typeof TenantDatabaseProviderConfigSchema
>;
export type RestHealthCheckResult = z.infer<typeof RestHealthCheckResultSchema>;
export type StorageProviderConfig = z.infer<typeof StorageProviderConfigSchema>;
export type TenantConfig = z.infer<typeof TenantConfigSchema>;
