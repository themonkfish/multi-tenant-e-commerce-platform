import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  TenantDatabaseConnectionInputSchema,
  TenantDatabaseConnectionViewSchema,
  type TenantDatabaseProviderConfig,
} from "@/core/domain/tenant-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { validateMongoConnectionString } from "@/adapters/data/mongodb/tenant-catalog";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

function connectionView(config: TenantDatabaseProviderConfig | null) {
  if (!config) return null;
  return TenantDatabaseConnectionViewSchema.parse(
    config.type === "supabase"
      ? {
          type: config.type,
          projectUrl: config.projectUrl,
          schema: config.schema,
          tenancyMode: config.tenancyMode,
          credentialConfigured: true,
          schemaVersion: null,
        }
      : {
          type: config.type,
          dbName: config.dbName,
          tenancyMode: config.tenancyMode,
          credentialConfigured: true,
          schemaVersion: null,
        },
  );
}

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = await getPlatformStore().getTenantDatabaseProvider(
    session.scope.id,
    session.scope.hostId,
  );
  return NextResponse.json({ connection: connectionView(config) });
}

export async function PUT(request: Request) {
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
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = TenantDatabaseConnectionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (
    parsed.data.type === "mongodb" &&
    parsed.data.connectionString !== undefined
  ) {
    try {
      validateMongoConnectionString(parsed.data.connectionString);
    } catch {
      return NextResponse.json(
        { error: "unsafe_connection_string" },
        { status: 400 },
      );
    }
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-database-provider-update",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const existing = await store.getTenantDatabaseProvider(
    session.scope.id,
    session.scope.hostId,
  );
  const vault = getSecretVault();
  const suppliedSecret =
    parsed.data.type === "supabase"
      ? parsed.data.serviceKey
      : parsed.data.connectionString;
  const existingSecretRef =
    existing?.type === parsed.data.type
      ? existing.type === "supabase"
        ? existing.serviceKeyRef
        : existing.connectionRef
      : undefined;
  const previousSecretRef = existing
    ? existing.type === "supabase"
      ? existing.serviceKeyRef
      : existing.connectionRef
    : undefined;
  if (!suppliedSecret && !existingSecretRef) {
    return NextResponse.json({ error: "credential_required" }, { status: 400 });
  }

  const secretRef = suppliedSecret
    ? await vault.putSecret({
        tenantId: session.scope.id,
        name:
          parsed.data.type === "supabase"
            ? "tenant-supabase-service-key"
            : "tenant-mongodb-connection-string",
        value: suppliedSecret,
      })
    : existingSecretRef;
  if (!secretRef) {
    return NextResponse.json({ error: "credential_required" }, { status: 400 });
  }

  const config: TenantDatabaseProviderConfig =
    parsed.data.type === "supabase"
      ? {
          type: "supabase",
          projectUrl: parsed.data.projectUrl,
          schema: "public",
          tenancyMode: "dedicated-project",
          serviceKeyRef: secretRef,
        }
      : {
          type: "mongodb",
          dbName: parsed.data.dbName,
          tenancyMode: "dedicated-db",
          connectionRef: secretRef,
        };
  const now = new Date().toISOString();
  let saved: TenantDatabaseProviderConfig | null;
  try {
    saved = await store.updateTenantDatabaseProvider({
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      config,
      updatedAt: now,
      auditEvent: {
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "tenant.database_provider.updated",
        resourceType: "tenant_database_provider",
        resourceId: session.scope.id,
        createdAt: now,
      },
    });
  } catch (error) {
    if (suppliedSecret) await vault.deleteSecret(secretRef);
    throw error;
  }
  if (!saved) {
    if (suppliedSecret) await vault.deleteSecret(secretRef);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let credentialCleanupWarning = false;
  if (previousSecretRef && previousSecretRef !== secretRef) {
    try {
      await vault.deleteSecret(previousSecretRef);
    } catch {
      credentialCleanupWarning = true;
    }
  }
  return NextResponse.json({
    connection: connectionView(saved),
    ...(credentialCleanupWarning
      ? { warning: "previous_credential_cleanup_failed" }
      : {}),
  });
}

export async function DELETE(request: Request) {
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
      "tenant-database-provider-delete",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const existing = await store.getTenantDatabaseProvider(
    session.scope.id,
    session.scope.hostId,
  );
  if (!existing) {
    return NextResponse.json(
      { error: "connection_not_configured" },
      { status: 404 },
    );
  }
  const now = new Date().toISOString();
  const removed = await store.deleteTenantDatabaseProvider({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.database_provider.deleted",
      resourceType: "tenant_database_provider",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const secretRef =
    existing.type === "supabase"
      ? existing.serviceKeyRef
      : existing.connectionRef;
  let credentialCleanupWarning = false;
  try {
    await getSecretVault().deleteSecret(secretRef);
  } catch {
    credentialCleanupWarning = true;
  }
  return NextResponse.json({
    removed: true,
    ...(credentialCleanupWarning
      ? { warning: "credential_cleanup_failed" }
      : {}),
  });
}
