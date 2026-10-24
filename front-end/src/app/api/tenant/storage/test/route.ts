import { NextResponse } from "next/server";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createTenantStorageAdapter } from "@/adapters/storage/tenant-storage-provider";

export async function POST(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-storage-provider-test",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const adapter = await createTenantStorageAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const result = await adapter.healthCheck();
    return NextResponse.json({
      status: result.ok ? "healthy" : "unhealthy",
      latencyMs: result.latencyMs,
      ...(result.details ? { details: result.details } : {}),
    });
  } catch (error) {
    console.error("Tenant storage connection test failed", {
      tenantId: session.scope.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "storage_connection_test_failed" },
      { status: 502 },
    );
  }
}
