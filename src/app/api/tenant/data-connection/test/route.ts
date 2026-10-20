import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { checkRestBackendHealth } from "@/adapters/data/rest/health-check";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-rest-health-check",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const config = await store.getTenantRestConnection(
    session.scope.id,
    session.scope.hostId,
  );
  if (!config) {
    return NextResponse.json(
      { error: "connection_not_configured" },
      { status: 400 },
    );
  }

  const apiKey = await getSecretVault().getSecret(config.apiKeyRef);
  const result = await checkRestBackendHealth(config, apiKey);
  return NextResponse.json({ result });
}
