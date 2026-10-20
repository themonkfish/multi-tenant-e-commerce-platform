import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformStore } from "@/lib/server/platform";
import { hashToken } from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getHostOwnerSession } from "@/lib/server/session";

const InviteSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
});

type TenantInviteRouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(
  request: Request,
  { params }: TenantInviteRouteProps,
) {
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = InviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "host-tenant-owner-invite",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const tenant = (await store.listTenantsForHost(session.scope.id)).find(
    (candidate) => candidate.id === tenantId,
  );
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  if (tenant.status !== "active") {
    return NextResponse.json(
      { error: "tenant_must_be_active" },
      { status: 409 },
    );
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const invite = {
    id: randomUUID(),
    tenantId: tenant.id,
    hostId: tenant.hostId,
    email: parsed.data.email,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
  try {
    await store.createTenantOwnerInvite(invite, {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "host", id: session.scope.id },
      action: "tenant.owner_invited",
      resourceType: "tenant_owner_invite",
      resourceId: invite.id,
      createdAt: invite.createdAt,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /already owns|already has a tenant owner/i.test(error.message)
    ) {
      return NextResponse.json(
        { error: "tenant_owner_already_exists" },
        { status: 409 },
      );
    }
    if (error instanceof Error && /only active tenants/i.test(error.message)) {
      return NextResponse.json(
        { error: "tenant_must_be_active" },
        { status: 409 },
      );
    }
    throw error;
  }

  const inviteUrl = new URL(
    `/en/tenant/accept-invite?token=${encodeURIComponent(token)}`,
    request.url,
  ).toString();
  return NextResponse.json({ inviteUrl, expiresAt: invite.expiresAt });
}
