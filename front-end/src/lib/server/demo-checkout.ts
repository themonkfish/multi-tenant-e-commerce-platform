import "server-only";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/server/env";

const DEMO_SESSION_PREFIX = "demo_";

export function isLocalDemoCheckoutEnabled(host: string | null): boolean {
  const env = getServerEnv();
  if (
    !host ||
    env.NODE_ENV !== "development" ||
    env.PLATFORM_STORE !== "file" ||
    env.PLATFORM_STORE_FILE !== ".local/demo-platform-store.json" ||
    !env.DEMO_CHECKOUT_ENABLED
  ) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function isDemoCheckoutSession(sessionId: string): boolean {
  return sessionId.startsWith(DEMO_SESSION_PREFIX);
}

export function createDemoCheckoutSessionId(attempt: number): string {
  return `${DEMO_SESSION_PREFIX}${attempt}_${randomUUID()}`;
}
