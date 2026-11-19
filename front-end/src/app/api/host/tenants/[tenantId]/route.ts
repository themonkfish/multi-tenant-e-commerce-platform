import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  TenantStatusSchema,
  UpdateTenantInputSchema,
} from "@/core/domain/host-portal";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";

const UpdateTenantSchema = z.object({ status: TenantStatusSchema });

type TenantRouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function PATCH(request: Request, { params }: TenantRouteProps) {
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    !canAccessPermission(session, "tenant:write", {
      kind: "tenant",
      id: tenantId,
      hostId: session.scope.id,
    })
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const statusParsed = UpdateTenantSchema.safeParse(rawBody);
  const detailsParsed = UpdateTenantInputSchema.safeParse(rawBody);
  if (!statusParsed.success && !detailsParsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "host-tenant-update", session.userId),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (
    statusParsed.success &&
    statusParsed.data.status === "active" &&
    !(await store.listHosts()).some(
      (host) => host.id === session.scope.id && host.status === "active",
    )
  ) {
    return NextResponse.json({ error: "host_unavailable" }, { status: 403 });
  }

  const now = new Date().toISOString();
  if (detailsParsed.success) {
    const tenant = await store.updateTenantDetails(
      session.scope.id,
      tenantId,
      detailsParsed.data,
      now,
      {
        id: randomUUID(),
        actorId: session.userId,
        scope: { kind: "host", id: session.scope.id },
        action: "tenant.updated",
        resourceType: "tenant",
        resourceId: tenantId,
        createdAt: now,
      },
    );
    if (!tenant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ tenant });
  }

  if (!statusParsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const tenant = await store.updateTenantStatus({
    hostId: session.scope.id,
    tenantId,
    status: statusParsed.data.status,
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "host", id: session.scope.id },
      action:
        statusParsed.data.status === "suspended"
          ? "tenant.suspended"
          : "tenant.activated",
      resourceType: "tenant",
      resourceId: tenantId,
      createdAt: now,
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ tenant });
}

export async function DELETE(request: Request, { params }: TenantRouteProps) {
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    !canAccessPermission(session, "tenant:write", {
      kind: "tenant",
      id: tenantId,
      hostId: session.scope.id,
    })
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "host-tenant-delete", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  const result = await store.deleteTenantForHost(session.scope.id, tenantId, {
    id: randomUUID(),
    actorId: session.userId,
    scope: { kind: "host", id: session.scope.id },
    action: "tenant.deleted",
    resourceType: "tenant",
    resourceId: tenantId,
    createdAt: now,
  });
  if (result === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
