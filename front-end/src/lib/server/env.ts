import "server-only";
import { z } from "zod";

const ServerEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PLATFORM_STORE: z.enum(["file", "supabase"]).default("file"),
  PLATFORM_SUPABASE_URL: z.url().optional(),
  PLATFORM_SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  PLATFORM_SECRET_KEY: z.string().min(1).optional(),
  SETUP_TOKEN: z.string().min(32).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  CARRIER_WEBHOOK_SECRET: z.string().min(16).optional(),
  SHIPROCKET_WEBHOOK_TOKEN: z.string().min(16).optional(),
  SHIPROCKET_API_EMAIL: z.email().optional(),
  SHIPROCKET_API_PASSWORD: z.string().min(1).optional(),
  SHIPROCKET_PICKUP_LOCATION: z.string().trim().min(1).max(120).optional(),
  BLUEDART_API_BASE_URL: z.url().optional(),
  BLUEDART_CUSTOMER_CODE: z.string().trim().min(1).max(80).optional(),
  BLUEDART_LOGIN_ID: z.string().trim().min(1).max(80).optional(),
  BLUEDART_LICENSE_KEY: z.string().min(1).optional(),
  OBSERVABILITY_METRICS_TOKEN: z.string().min(16).optional(),
  DISTRIBUTED_RATE_LIMIT_URL: z.url().optional(),
  DISTRIBUTED_RATE_LIMIT_TOKEN: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  DISTRIBUTED_RATE_LIMIT_PREFIX: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .default("platform"),
  DISTRIBUTED_RATE_LIMIT_FAIL_MODE: z
    .enum(["open", "closed"])
    .optional(),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  INVITATION_EMAIL_FROM: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  VERCEL_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  VERCEL_PROJECT_ID: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  VERCEL_TEAM_ID: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  DEMO_CHECKOUT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TENANT_REST_ALLOW_LOCAL_HTTP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NEXT_PUBLIC_PLATFORM_DOMAIN: z.string().min(1).optional(),
  PLATFORM_STORE_FILE: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function getServerEnv(): ServerEnv {
  const env = ServerEnvSchema.parse(process.env);

  if (env.PLATFORM_STORE === "supabase") {
    if (!env.PLATFORM_SUPABASE_URL || !env.PLATFORM_SUPABASE_SERVICE_KEY) {
      throw new Error(
        "PLATFORM_SUPABASE_URL and PLATFORM_SUPABASE_SERVICE_KEY are required when PLATFORM_STORE=supabase",
      );
    }
  }

  if (
    env.NODE_ENV === "production" &&
    (!env.PLATFORM_SECRET_KEY ||
      !env.SESSION_SECRET ||
      env.PLATFORM_STORE !== "supabase")
  ) {
    throw new Error(
      "PLATFORM_SECRET_KEY and SESSION_SECRET must be configured in production",
    );
  }

  return env;
}
