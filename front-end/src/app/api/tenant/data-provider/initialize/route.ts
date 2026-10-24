import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createTenantDatabaseAdapter } from "@/adapters/data/database/tenant-provider-factory";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
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
      "tenant-database-provider-initialize",
      session.userId,
    ),
    limit: 3,
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
    const schemaVersion = await adapter.initializeSchema();
    const now = new Date().toISOString();
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.database_schema.initialized",
      resourceType: "tenant_database_schema",
      resourceId: session.scope.id,
      createdAt: now,
    });
    return NextResponse.json({ schemaVersion, status: "current" });
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 409) {
      return NextResponse.json(
        { error: "schema_upgrade_required" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "schema_initialization_failed" },
      { status: 502 },
    );
  }
}
