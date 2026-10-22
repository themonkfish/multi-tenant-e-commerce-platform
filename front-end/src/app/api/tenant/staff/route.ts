import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  TenantStaffPermissionSchema,
  TenantStaffViewSchema,
} from "@/core/domain/tenant-identities";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

const CreateStaffSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(14).max(128),
  permissions: z.array(TenantStaffPermissionSchema).min(1).max(4),
});

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "staff:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const staff = await getPlatformStore().listTenantStaff(session.scope.id);
  return NextResponse.json({ data: staff });
}

export async function POST(request: Request) {
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
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateStaffSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-staff-create", session.userId),
    limit: 10,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const now = new Date().toISOString();
  try {
    const staff = await store.createTenantStaff({
      id: randomUUID(),
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      email: parsed.data.email,
      passwordHash: await hash(parsed.data.password),
      permissions: [
        ...new Set([
          ...parsed.data.permissions,
          ...(parsed.data.permissions.includes("catalog:write")
            ? ["catalog:read" as const]
            : []),
          ...(parsed.data.permissions.includes("orders:write")
            ? ["orders:read" as const]
            : []),
        ]),
      ],
      createdAt: now,
    });
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.staff.created",
      resourceType: "tenant_staff",
      resourceId: staff.id,
      createdAt: now,
    });
    return NextResponse.json(
      { staff: TenantStaffViewSchema.parse(staff) },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "An account with this email already exists for the tenant"
    ) {
      return NextResponse.json({ error: "account_exists" }, { status: 409 });
    }
    throw error;
  }
}
