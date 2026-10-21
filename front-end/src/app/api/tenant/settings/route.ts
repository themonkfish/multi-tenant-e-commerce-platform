import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { TenantStoreSettingsSchema } from "@/core/domain/host-portal";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "settings:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: tenantId, hostId } = session.scope;

  const store = getPlatformStore();
  const tenants = await store.listTenantsForHost(hostId);
  const tenant = tenants.find(
    (candidate) => candidate.id === tenantId && candidate.hostId === hostId,
  );
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const settings = await store.getTenantStoreSettings(
    tenant.id,
    tenant.hostId,
    tenant.name,
  );
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "settings:write")) {
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
  const parsed = TenantStoreSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-settings-update", session.userId),
    limit: 20,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  const settings = await store.updateTenantStoreSettings({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    settings: parsed.data,
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.settings.updated",
      resourceType: "tenant_settings",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!settings) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ settings });
}
