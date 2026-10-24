import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  TenantStorageConnectionInputSchema,
  TenantStorageConnectionViewSchema,
  TenantStorageProviderConfigSchema,
  type TenantStorageProviderConfig,
} from "@/core/domain/tenant-config";
import { resolvePublicAddress } from "@/adapters/data/rest/health-check";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

function storageView(config: TenantStorageProviderConfig | null) {
  if (!config) return null;
  return TenantStorageConnectionViewSchema.parse({
    type: config.type,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    publicBaseUrl: config.publicBaseUrl,
    pathStyle: config.pathStyle,
    credentialsConfigured: true,
  });
}

async function isPublicHttpsUrl(value: string): Promise<boolean> {
  const url = new URL(value);
  try {
    return Boolean(await resolvePublicAddress(url.hostname));
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = await getPlatformStore().getTenantStorageProvider(
    session.scope.id,
    session.scope.hostId,
  );
  return NextResponse.json({ connection: storageView(config) });
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
  const parsed = TenantStorageConnectionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const targets = [
    ...(parsed.data.endpoint ? [parsed.data.endpoint] : []),
    parsed.data.publicBaseUrl,
  ];
  if (!(await Promise.all(targets.map(isPublicHttpsUrl))).every(Boolean)) {
    return NextResponse.json({ error: "unsafe_storage_url" }, { status: 400 });
  }

  const store = getPlatformStore();
  const existing = await store.getTenantStorageProvider(
    session.scope.id,
    session.scope.hostId,
  );
  const suppliedCredentials =
    parsed.data.accessKeyId && parsed.data.secretAccessKey
      ? JSON.stringify({
          accessKeyId: parsed.data.accessKeyId,
          secretAccessKey: parsed.data.secretAccessKey,
          ...(parsed.data.sessionToken
            ? { sessionToken: parsed.data.sessionToken }
            : {}),
        })
      : undefined;
  if (!suppliedCredentials && !existing) {
    return NextResponse.json(
      { error: "storage_credentials_required" },
      { status: 400 },
    );
  }
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-storage-provider-update",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const vault = getSecretVault();
  const credentialsRef = suppliedCredentials
    ? await vault.putSecret({
        tenantId: session.scope.id,
        name: "tenant-s3-storage-credentials",
        value: suppliedCredentials,
      })
    : existing?.credentialsRef;
  if (!credentialsRef) {
    return NextResponse.json(
      { error: "storage_credentials_required" },
      { status: 400 },
    );
  }
  const config = TenantStorageProviderConfigSchema.parse({
    type: "s3",
    endpoint: parsed.data.endpoint,
    region: parsed.data.region,
    bucket: parsed.data.bucket,
    publicBaseUrl: parsed.data.publicBaseUrl,
    pathStyle: parsed.data.pathStyle,
    credentialsRef,
  });
  const now = new Date().toISOString();
  let saved: TenantStorageProviderConfig | null;
  try {
    saved = await store.updateTenantStorageProvider({
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      config,
      updatedAt: now,
      auditEvent: {
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "tenant.storage_provider.updated",
        resourceType: "tenant_storage_provider",
        resourceId: session.scope.id,
        createdAt: now,
      },
    });
  } catch (error) {
    if (suppliedCredentials) await vault.deleteSecret(credentialsRef);
    throw error;
  }
  if (!saved) {
    if (suppliedCredentials) await vault.deleteSecret(credentialsRef);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let credentialCleanupWarning = false;
  if (
    suppliedCredentials &&
    existing &&
    existing.credentialsRef !== credentialsRef
  ) {
    try {
      await vault.deleteSecret(existing.credentialsRef);
    } catch {
      credentialCleanupWarning = true;
    }
  }
  return NextResponse.json({
    connection: storageView(saved),
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
      "tenant-storage-provider-delete",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const existing = await store.getTenantStorageProvider(
    session.scope.id,
    session.scope.hostId,
  );
  if (!existing) {
    return NextResponse.json(
      { error: "storage_not_configured" },
      { status: 404 },
    );
  }
  const now = new Date().toISOString();
  const removed = await store.deleteTenantStorageProvider({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.storage_provider.deleted",
      resourceType: "tenant_storage_provider",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  let credentialCleanupWarning = false;
  try {
    await getSecretVault().deleteSecret(existing.credentialsRef);
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
