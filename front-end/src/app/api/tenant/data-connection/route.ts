import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  TenantRestDataProviderConfigSchema,
  TenantRestConnectionInputSchema,
  TenantRestConnectionViewSchema,
} from "@/core/domain/tenant-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import {
  isLocalTestUrl,
  isPublicIpAddress,
  validateRestBaseUrl,
} from "@/adapters/data/rest/health-check";

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = await getPlatformStore().getTenantRestConnection(
    session.scope.id,
    session.scope.hostId,
  );
  return NextResponse.json({
    connection: TenantRestConnectionViewSchema.parse({
      baseUrl: config?.baseUrl ?? "",
      apiVersion: config?.apiVersion ?? "v1",
      apiKeyConfigured: Boolean(config),
    }),
  });
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
  const parsed = TenantRestConnectionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const url = validateRestBaseUrl(parsed.data.baseUrl);
  if (
    !url ||
    (!isLocalTestUrl(url) &&
      (url.hostname.startsWith("[")
        ? !isPublicIpAddress(url.hostname.slice(1, -1))
        : /^[\d.]+$/.test(url.hostname) && !isPublicIpAddress(url.hostname)))
  ) {
    return NextResponse.json({ error: "unsafe_url" }, { status: 400 });
  }

  const store = getPlatformStore();
  const existing = await store.getTenantRestConnection(
    session.scope.id,
    session.scope.hostId,
  );
  const apiKey = parsed.data.apiKey;
  if ((!existing && !apiKey) || (apiKey !== undefined && apiKey.length === 0)) {
    return NextResponse.json({ error: "api_key_required" }, { status: 400 });
  }
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-rest-connection-update",
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
  const apiKeyRef = apiKey
    ? await vault.putSecret({
        tenantId: session.scope.id,
        name: "tenant-rest-api-key",
        value: apiKey,
      })
    : existing?.apiKeyRef;
  if (!apiKeyRef) {
    return NextResponse.json({ error: "api_key_required" }, { status: 400 });
  }
  const config = TenantRestDataProviderConfigSchema.parse({
    type: "rest",
    baseUrl: parsed.data.baseUrl,
    apiVersion: parsed.data.apiVersion,
    authMode: "apiKey",
    apiKeyRef,
  });
  const now = new Date().toISOString();
  let saved;
  try {
    saved = await store.updateTenantRestConnection({
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      config,
      updatedAt: now,
      auditEvent: {
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "tenant.rest_connection.updated",
        resourceType: "tenant_rest_connection",
        resourceId: session.scope.id,
        createdAt: now,
      },
    });
  } catch (error) {
    if (apiKey) {
      await vault.deleteSecret(apiKeyRef);
    }
    throw error;
  }
  if (!saved) {
    if (apiKey) {
      await vault.deleteSecret(apiKeyRef);
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  let credentialCleanupWarning = false;
  if (apiKey && existing && existing.apiKeyRef !== apiKeyRef) {
    try {
      await vault.deleteSecret(existing.apiKeyRef);
    } catch {
      credentialCleanupWarning = true;
    }
  }

  return NextResponse.json({
    connection: TenantRestConnectionViewSchema.parse({
      baseUrl: config.baseUrl,
      apiVersion: config.apiVersion,
      apiKeyConfigured: true,
    }),
    ...(credentialCleanupWarning
      ? { warning: "previous_credential_cleanup_failed" }
      : {}),
  });
}
