import "server-only";
import { hashToken } from "./crypto";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) {
    return false;
  }

  try {
    const requestUrl = new URL(request.url);
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim();
    const protocol = forwardedProtocol ?? requestUrl.protocol.slice(0, -1);
    if (protocol !== "http" && protocol !== "https") return false;

    const requestOrigin = new URL(`${protocol}://${host}`);
    if (
      requestOrigin.username ||
      requestOrigin.password ||
      requestOrigin.pathname !== "/" ||
      requestOrigin.search ||
      requestOrigin.hash
    ) {
      return false;
    }
    const originUrl = new URL(origin);
    return (
      !originUrl.username &&
      !originUrl.password &&
      originUrl.pathname === "/" &&
      !originUrl.search &&
      !originUrl.hash &&
      originUrl.origin === requestOrigin.origin
    );
  } catch {
    return false;
  }
}

export function createRateLimitKey(
  request: Request,
  action: string,
  subject?: string,
): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientAddress =
    request.headers.get("x-real-ip") ??
    forwardedFor?.split(",")[0]?.trim() ??
    "unknown";

  return hashToken(
    [action, clientAddress, ...(subject ? [subject] : [])].join(":"),
  );
}
