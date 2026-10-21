import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import {
  createTenantStaffSession,
  getTenantStaffCookieName,
  tenantStaffCookieOptions,
} from "@/lib/server/session";

const LoginSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
  }

  const scope = await getRequestDomainScope();
  if (scope?.kind !== "tenant") {
    return NextResponse.json({ error: "tenant_unavailable" }, { status: 404 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: hashToken(
      `${createRateLimitKey(request, "tenant-staff-login")}:${scope.tenant.id}:${parsed.data.email}`,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const staff = await store.getTenantStaffByEmail(
    scope.tenant.id,
    parsed.data.email,
  );
  const passwordValid = staff
    ? await verify(staff.passwordHash, parsed.data.password)
    : false;
  if (
    !staff ||
    !passwordValid ||
    staff.hostId !== scope.host.id ||
    !staff.active
  ) {
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: staff?.id ?? "anonymous",
      scope: scope.scope,
      action: "tenant.staff_login.failed",
      resourceType: "tenant_staff_auth",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: staff.id,
    scope: scope.scope,
    action: "tenant.staff_login.succeeded",
    resourceType: "tenant_staff_auth",
    createdAt: new Date().toISOString(),
  });
  const response = NextResponse.json({
    ok: true,
    permissions: staff.permissions,
  });
  response.cookies.set(
    getTenantStaffCookieName(),
    await createTenantStaffSession(staff.id, staff.tenantId, staff.hostId),
    tenantStaffCookieOptions(),
  );
  return response;
}
