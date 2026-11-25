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

const HttpsStorageUrlSchema = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
});

const S3BucketNameSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.includes(".-") &&
      !value.includes("-.") &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value),
  );

const TenantStorageBaseSchema = z.object({
  type: z.literal("s3"),
  endpoint: HttpsStorageUrlSchema.optional(),
  region: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  bucket: S3BucketNameSchema,
  publicBaseUrl: HttpsStorageUrlSchema,
  pathStyle: z.boolean().default(false),
});

export const TenantStorageProviderConfigSchema = z.discriminatedUnion("type", [
  TenantStorageBaseSchema.extend({
    type: z.literal("s3"),
    credentialsRef: SecretRefSchema,
  }),
  z.object({
    type: z.literal("gcs"),
    bucket: S3BucketNameSchema,
    publicBaseUrl: HttpsStorageUrlSchema,
    credentialsRef: SecretRefSchema,
  }),
  z.object({
    type: z.literal("azure"),
    accountName: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9]+$/),
    container: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    publicBaseUrl: HttpsStorageUrlSchema,
    credentialsRef: SecretRefSchema,
  }),
  z.object({
    type: z.literal("supabase"),
    projectUrl: z
      .url({ protocol: /^https$/ })
      .refine(isTenantSupabaseProjectUrl),
    bucket: S3BucketNameSchema,
    credentialsRef: SecretRefSchema,
  }),
]);

export const TenantLogisticsProviderConfigSchema = z.object({
  type: z.literal("shiprocket"),
  apiEmail: z.email(),
  pickupLocation: z.string().trim().min(1).max(120),
  credentialsRef: SecretRefSchema,
});

export type TenantLogisticsProviderConfig = z.infer<
  typeof TenantLogisticsProviderConfigSchema
>;

export const TenantLogisticsConnectionInputSchema = z.object({
  apiEmail: z.email(),
  apiPassword: z.string().min(1).max(2048).optional(),
  pickupLocation: z.string().trim().min(1).max(120),
});

export const TenantLogisticsConnectionViewSchema = z.object({
  type: z.literal("shiprocket"),
  apiEmail: z.email(),
  pickupLocation: z.string().trim().min(1).max(120),
  credentialsConfigured: z.boolean(),
});

export const TenantStorageConnectionInputSchema = z.discriminatedUnion("type", [
  TenantStorageBaseSchema.extend({
    type: z.literal("s3"),
    accessKeyId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .optional(),
    secretAccessKey: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .optional(),
    sessionToken: z
      .string()
      .min(1)
      .max(8192)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .optional(),
  }).superRefine((input, context) => {
    if (Boolean(input.accessKeyId) !== Boolean(input.secretAccessKey)) {
      context.addIssue({
        code: "custom",
        path: ["secretAccessKey"],
        message:
          "Access key ID and secret access key must be supplied together",
      });
    }
    if (input.sessionToken && !input.accessKeyId) {
      context.addIssue({
        code: "custom",
        path: ["sessionToken"],
        message: "A session token requires access key credentials",
      });
    }
  }),
  z.object({
    type: z.literal("supabase"),
    projectUrl: z
      .url({ protocol: /^https$/ })
      .refine(isTenantSupabaseProjectUrl),
    bucket: S3BucketNameSchema,
    serviceKey: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .optional(),
  }),
  z.object({
    type: z.literal("gcs"),
    bucket: S3BucketNameSchema,
    publicBaseUrl: HttpsStorageUrlSchema,
    serviceAccountJson: z
      .string()
      .min(2)
      .max(16384)
      .optional(),
  }),
  z.object({
    type: z.literal("azure"),
    accountName: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9]+$/),
    container: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    publicBaseUrl: HttpsStorageUrlSchema,
    accountKey: z
      .string()
      .min(16)
      .max(4096)
      .optional(),
  }),
]);

export const TenantStorageConnectionViewSchema = z.discriminatedUnion("type", [
  TenantStorageBaseSchema.extend({
    type: z.literal("s3"),
    credentialsConfigured: z.boolean(),
  }),
  z.object({
    type: z.literal("supabase"),
    projectUrl: z.string(),
    bucket: z.string(),
    credentialsConfigured: z.boolean(),
  }),
  z.object({
    type: z.literal("gcs"),
    bucket: z.string(),
    publicBaseUrl: z.string(),
    credentialsConfigured: z.boolean(),
  }),
  z.object({
    type: z.literal("azure"),
    accountName: z.string(),
    container: z.string(),
    publicBaseUrl: z.string(),
    credentialsConfigured: z.boolean(),
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

export type TenantProvisioningReadinessInput = {
  restConfigured: boolean;
  databaseConfigured: boolean;
  storageConfigured: boolean;
  stripeConfigured: boolean;
  stripeEnabled: boolean;
  cashOnDeliveryEnabled: boolean;
  staffCount: number;
  customDomainCount: number;
};

export type TenantProvisioningReadiness = {
  ready: boolean;
  configuredCount: number;
  optionalCount: number;
  items: {
    key: "catalog" | "payments" | "storage" | "staff" | "customDomain";
    configured: boolean;
  }[];
};

export function getTenantProvisioningReadiness(
  input: TenantProvisioningReadinessInput,
): TenantProvisioningReadiness {
  const catalogConfigured = input.restConfigured || input.databaseConfigured;
  const paymentsConfigured =
    (input.stripeEnabled && input.stripeConfigured) ||
    input.cashOnDeliveryEnabled;
  const items = [
    { key: "catalog" as const, configured: catalogConfigured },
    { key: "payments" as const, configured: paymentsConfigured },
    { key: "storage" as const, configured: input.storageConfigured },
    { key: "staff" as const, configured: input.staffCount > 0 },
    {
      key: "customDomain" as const,
      configured: input.customDomainCount > 0,
    },
  ];

  return {
    ready: catalogConfigured && paymentsConfigured,
    configuredCount: items.filter((item) => item.configured).length,
    optionalCount: items
      .filter(
        (item) =>
          item.key === "storage" ||
          item.key === "staff" ||
          item.key === "customDomain",
      )
      .filter((item) => item.configured).length,
    items,
  };
}
export type RestHealthCheckResult = z.infer<typeof RestHealthCheckResultSchema>;
export type StorageProviderConfig = z.infer<typeof StorageProviderConfigSchema>;
export type TenantStorageProviderConfig = z.infer<
  typeof TenantStorageProviderConfigSchema
>;
export type TenantConfig = z.infer<typeof TenantConfigSchema>;
