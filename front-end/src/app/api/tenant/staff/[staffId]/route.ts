import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  TenantStaffPermissionSchema,
  TenantStaffViewSchema,
  type TenantStaffPermission,
} from "@/core/domain/tenant-identities";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

const UpdateStaffSchema = z.union([
  z.object({ active: z.boolean() }).strict(),
  z.object({ password: z.string().min(14).max(128) }).strict(),
  z
    .object({
      permissions: z.array(TenantStaffPermissionSchema).min(1).max(4),
    })
    .strict(),
]);

type RouteContext = {
  params: Promise<{ staffId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "staff:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { staffId } = await params;
  if (!z.uuid().safeParse(staffId).success) {
    return NextResponse.json({ error: "invalid_staff_id" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = UpdateStaffSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-staff-update",
      `${session.userId}:${staffId}`,
    ),
    limit: 10,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const passwordHash =
    "password" in parsed.data ? await hash(parsed.data.password) : undefined;
  const permissions =
    "permissions" in parsed.data
      ? normalizePermissions(parsed.data.permissions)
      : undefined;
  const staff = await store.updateTenantStaff({
    staffId,
    tenantId: session.scope.id,
    ...("active" in parsed.data ? { active: parsed.data.active } : {}),
    ...(passwordHash ? { passwordHash } : {}),
    ...(permissions ? { permissions } : {}),
  });
  if (!staff) {
    return NextResponse.json({ error: "staff_not_found" }, { status: 404 });
  }

  const action =
    "active" in parsed.data
      ? parsed.data.active
        ? "tenant.staff.reactivated"
        : "tenant.staff.disabled"
      : "password" in parsed.data
        ? "tenant.staff.password_reset"
        : "tenant.staff.permissions_updated";
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: session.scope,
    action,
    resourceType: "tenant_staff",
    resourceId: staff.id,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ staff: TenantStaffViewSchema.parse(staff) });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "staff:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { staffId } = await params;
  if (!z.uuid().safeParse(staffId).success) {
    return NextResponse.json({ error: "invalid_staff_id" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-staff-delete",
      `${session.userId}:${staffId}`,
    ),
    limit: 5,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const deleted = await store.deleteTenantStaff(staffId, session.scope.id);
  if (!deleted) {
    return NextResponse.json({ error: "staff_not_found" }, { status: 404 });
  }
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: session.scope,
    action: "tenant.staff.deleted",
    resourceType: "tenant_staff",
    resourceId: staffId,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ deleted: true });
}

function normalizePermissions(
  permissions: TenantStaffPermission[],
): TenantStaffPermission[] {
  return [
    ...new Set([
      ...permissions,
      ...(permissions.includes("catalog:write")
        ? ["catalog:read" as const]
        : []),
      ...(permissions.includes("orders:write") ? ["orders:read" as const] : []),
    ]),
  ];
}
