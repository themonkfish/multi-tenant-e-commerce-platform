import { NextResponse } from "next/server";
import { createTenantDatabaseAdapter } from "@/adapters/data/database/tenant-provider-factory";
import { TENANT_CATALOG_SCHEMA_VERSION } from "@/adapters/data/database/tenant-database-adapter";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { canAccessPermission } from "@/core/tenancy/scope";
import { getTenantOwnerSession } from "@/lib/server/session";

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
      "tenant-database-provider-test",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const adapter = await createTenantDatabaseAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const schemaVersion = await adapter.checkConnection();
    return NextResponse.json({
      result: {
        status: "healthy",
        schemaVersion,
        currentSchemaVersion: TENANT_CATALOG_SCHEMA_VERSION,
        schemaStatus:
          schemaVersion === null
            ? "not_initialized"
            : schemaVersion === TENANT_CATALOG_SCHEMA_VERSION
              ? "current"
              : schemaVersion < TENANT_CATALOG_SCHEMA_VERSION
                ? "upgrade_available"
                : "upgrade_required",
      },
    });
  } catch {
    return NextResponse.json(
      {
        result: {
          status: "unhealthy",
          schemaVersion: null,
          currentSchemaVersion: TENANT_CATALOG_SCHEMA_VERSION,
          schemaStatus: "unavailable",
        },
      },
      { status: 502 },
    );
  }
}
