import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  TenantLogisticsConnectionInputSchema,
  TenantLogisticsConnectionViewSchema,
} from "@/core/domain/tenant-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const store = getPlatformStore();
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const logistics = settings.shipping.logistics;
  if (!logistics) return NextResponse.json({ connection: null });
  return NextResponse.json({
    connection:
      logistics.type === "shiprocket"
        ? TenantLogisticsConnectionViewSchema.parse({
            type: "shiprocket",
            apiEmail: logistics.apiEmail,
            pickupLocation: logistics.pickupLocation,
            credentialsConfigured: true,
          })
        : TenantLogisticsConnectionViewSchema.parse({
            type: "bluedart",
            baseUrl: logistics.baseUrl,
            customerCode: logistics.customerCode,
            loginId: logistics.loginId,
            credentialsConfigured: true,
          }),
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
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  if (!settings.shipping.logistics) {
    return NextResponse.json({ error: "logistics_not_configured" }, { status: 404 });
  }
  const credentialsRef = settings.shipping.logistics.credentialsRef;
  const now = new Date().toISOString();
  const saved = await store.updateTenantStoreSettings({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    settings: {
      ...settings,
      shipping: { ...settings.shipping, logistics: undefined },
    },
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.logistics_provider.deleted",
      resourceType: "tenant_logistics_provider",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!saved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    await getSecretVault().deleteSecret(credentialsRef);
  } catch {
    // Configuration is removed; stale secret cleanup can be retried operationally.
  }
  return NextResponse.json({ connection: null });
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
  const parsed = TenantLogisticsConnectionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-logistics-update", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const existing = settings.shipping.logistics;
  const suppliedCredentials =
    parsed.data.type === "shiprocket"
      ? parsed.data.apiPassword
      : parsed.data.licenseKey;
  if (!suppliedCredentials && !existing) {
    return NextResponse.json(
      { error: "logistics_credentials_required" },
      { status: 400 },
    );
  }
  const vault = getSecretVault();
  let credentialsRef = existing?.credentialsRef;
  let suppliedRef: string | undefined;
  if (suppliedCredentials) {
    suppliedRef = await vault.putSecret({
      tenantId: session.scope.id,
      name:
        parsed.data.type === "shiprocket"
          ? "tenant-shiprocket-api-password"
          : "tenant-bluedart-license-key",
      value:
        parsed.data.type === "bluedart"
          ? JSON.stringify({
              customerCode: parsed.data.customerCode,
              loginId: parsed.data.loginId,
              licenseKey: parsed.data.licenseKey,
              baseUrl: parsed.data.baseUrl,
            })
          : parsed.data.apiPassword!,
    });
    credentialsRef = suppliedRef;
  }
  if (!credentialsRef) {
    return NextResponse.json(
      { error: "logistics_credentials_required" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const logistics =
    parsed.data.type === "shiprocket"
      ? {
          type: "shiprocket" as const,
          apiEmail: parsed.data.apiEmail,
          pickupLocation: parsed.data.pickupLocation,
          credentialsRef,
        }
      : {
          type: "bluedart" as const,
          baseUrl: parsed.data.baseUrl,
          customerCode: parsed.data.customerCode,
          loginId: parsed.data.loginId,
          credentialsRef,
        };
  const saved = await store.updateTenantStoreSettings({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    settings: {
      ...settings,
      shipping: { ...settings.shipping, logistics },
    },
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.logistics_provider.updated",
      resourceType: "tenant_logistics_provider",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!saved) {
    if (suppliedRef) await vault.deleteSecret(suppliedRef);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (suppliedRef && existing && existing.credentialsRef !== suppliedRef) {
    try {
      await vault.deleteSecret(existing.credentialsRef);
    } catch {
      // The new secret remains usable; stale cleanup is reported by the response.
    }
  }
  return NextResponse.json({
    connection:
      logistics.type === "shiprocket"
        ? TenantLogisticsConnectionViewSchema.parse({
            type: "shiprocket",
            apiEmail: logistics.apiEmail,
            pickupLocation: logistics.pickupLocation,
            credentialsConfigured: true,
          })
        : TenantLogisticsConnectionViewSchema.parse({
            type: "bluedart",
            baseUrl: logistics.baseUrl,
            customerCode: logistics.customerCode,
            loginId: logistics.loginId,
            credentialsConfigured: true,
          }),
  });
}
