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
