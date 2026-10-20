import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { PlatformDatabase } from "./database.types";
import { getServerEnv } from "@/lib/server/env";

export function createPlatformSupabaseClient() {
  const env = getServerEnv();
  if (!env.PLATFORM_SUPABASE_URL || !env.PLATFORM_SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Platform Supabase is not configured; set PLATFORM_SUPABASE_URL and PLATFORM_SUPABASE_SERVICE_KEY",
    );
  }

  return createClient<PlatformDatabase>(
    env.PLATFORM_SUPABASE_URL,
    env.PLATFORM_SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
