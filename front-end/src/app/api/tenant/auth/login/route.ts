import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { getPlatformStore } from "@/lib/server/platform";
import {
  createTenantOwnerSession,
  getTenantOwnerCookieName,
  tenantOwnerCookieOptions,
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

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: hashToken(
      `${createRateLimitKey(request, "tenant-owner-login")}:${parsed.data.email}`,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const owner = await store.getTenantOwnerByEmail(parsed.data.email);
  const passwordValid = owner
    ? await verify(owner.passwordHash, parsed.data.password)
    : false;
  const [host, tenants] = owner
    ? await Promise.all([
        store
          .listHosts()
          .then((hosts) =>
            hosts.find((candidate) => candidate.id === owner.hostId),
          ),
        store.listTenantsForHost(owner.hostId),
      ])
    : [undefined, []];
  const tenant = owner
    ? tenants.find(
        (candidate) =>
          candidate.id === owner.tenantId && candidate.hostId === owner.hostId,
      )
    : undefined;
  if (
    !owner ||
    !passwordValid ||
    !host ||
    host.status !== "active" ||
    !tenant ||
    tenant.status !== "active"
  ) {
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: owner?.id ?? "anonymous",
      scope: { kind: "platform", id: "platform" },
      action: "tenant.owner_login.failed",
      resourceType: "tenant_owner_auth",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const now = new Date().toISOString();
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: owner.id,
    scope: { kind: "tenant", id: owner.tenantId, hostId: owner.hostId },
    action: "tenant.owner_login.succeeded",
    resourceType: "tenant_owner_auth",
    createdAt: now,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    getTenantOwnerCookieName(),
    await createTenantOwnerSession(owner.id, owner.tenantId, owner.hostId),
    tenantOwnerCookieOptions(),
  );
  return response;
}
