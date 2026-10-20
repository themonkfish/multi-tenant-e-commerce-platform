import "server-only";
import type { PlatformStore } from "@/core/ports/platform-store";
import { getServerEnv } from "@/lib/server/env";
import { FilePlatformStore } from "./file/platform-store";
import { SupabasePlatformStore } from "./supabase/platform-store";

export function createPlatformStore(): PlatformStore {
  const env = getServerEnv();
  return env.PLATFORM_STORE === "supabase"
    ? new SupabasePlatformStore()
    : new FilePlatformStore();
}
