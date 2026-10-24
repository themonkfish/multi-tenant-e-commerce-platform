import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformStore } from "@/lib/server/platform";
import { hashToken } from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getSuperAdminSession } from "@/lib/server/session";
import { canAccessPermission } from "@/core/tenancy/scope";
import { sendInvitationEmail } from "@/lib/server/invitation-email";
import { createInvitationUrl } from "@/lib/server/invitation-links";

const InviteSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
});

type InviteRouteProps = {
  params: Promise<{ hostId: string }>;
};

export async function POST(request: Request, { params }: InviteRouteProps) {
  const session = await getSuperAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const parsed = InviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { hostId } = await params;
  if (!z.uuid().safeParse(hostId).success) {
    return NextResponse.json({ error: "host_not_found" }, { status: 404 });
  }
  if (
    !canAccessPermission(session, "platform:write", {
      kind: "host",
      id: hostId,
    })
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "platform-host-owner-invite",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!(await store.listHosts()).some((host) => host.id === hostId)) {
    return NextResponse.json({ error: "host_not_found" }, { status: 404 });
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const invite = {
    id: randomUUID(),
    hostId,
    email: parsed.data.email,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  try {
    await store.createHostOwnerInvite(invite, {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "host", id: hostId },
      action: "host.owner_invited",
      resourceType: "host_owner_invite",
      resourceId: invite.id,
      createdAt: invite.createdAt,
    });
  } catch (error) {
    if (error instanceof Error && /already owns/i.test(error.message)) {
      return NextResponse.json(
        { error: "host_owner_already_exists" },
        { status: 409 },
      );
    }
    if (error instanceof Error && /only active hosts/i.test(error.message)) {
      return NextResponse.json(
        { error: "host_must_be_active" },
        { status: 409 },
      );
    }
    throw error;
  }

  const setupState = await store.getSetupState();
  const inviteUrl = createInvitationUrl(
    request,
    setupState.platformDomain,
    "/en/host/accept-invite",
    token,
  );
  const deliveryStatus = await sendInvitationEmail({
    role: "host_owner",
    to: invite.email,
    inviteUrl,
    expiresAt: invite.expiresAt,
  });
  return NextResponse.json({
    inviteUrl,
    expiresAt: invite.expiresAt,
    deliveryStatus,
  });
}
