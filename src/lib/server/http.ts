import "server-only";
import { hashToken } from "./crypto";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function createRateLimitKey(request: Request, action: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientAddress =
    request.headers.get("x-real-ip") ??
    forwardedFor?.split(",")[0]?.trim() ??
    "unknown";

  return hashToken(`${action}:${clientAddress}`);
}
