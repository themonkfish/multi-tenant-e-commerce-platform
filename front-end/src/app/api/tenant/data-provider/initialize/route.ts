import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createTenantDatabaseAdapter } from "@/adapters/data/database/tenant-provider-factory";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import {
  classifyTenantDatabaseSchema,
  TENANT_CATALOG_SCHEMA_VERSION,
} from "@/adapters/data/database/tenant-database-adapter";
import { z } from "zod";

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
  let confirmUpgrade = false;
  try {
    const body = await request.json();
    confirmUpgrade =
      z.object({ confirmUpgrade: z.literal(true).optional() }).safeParse(body)
        .data?.confirmUpgrade === true;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  try {
    const adapter = await createTenantDatabaseAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const schemaVersion = await adapter.getSchemaVersion();
    const schemaStatus = classifyTenantDatabaseSchema(schemaVersion);
    if (schemaStatus === "upgrade_required") {
      return NextResponse.json(
        {
          error: "schema_upgrade_required",
          schemaVersion,
          currentSchemaVersion: TENANT_CATALOG_SCHEMA_VERSION,
        },
        { status: 409 },
      );
    }
    if (schemaStatus === "upgrade_available" && !confirmUpgrade) {
      return NextResponse.json(
        {
          error: "schema_upgrade_confirmation_required",
          schemaVersion,
          currentSchemaVersion: TENANT_CATALOG_SCHEMA_VERSION,
        },
        { status: 409 },
      );
    }
    const initializedVersion = await adapter.initializeSchema();
    const now = new Date().toISOString();
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action:
        schemaStatus === "upgrade_available"
          ? "tenant.database_schema.upgraded"
          : "tenant.database_schema.initialized",
      resourceType: "tenant_database_schema",
      resourceId: session.scope.id,
      createdAt: now,
    });
    return NextResponse.json({
      schemaVersion: initializedVersion,
      status: "current",
    });
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
