import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import {
  createHostOwnerSession,
  getHostOwnerCookieName,
  hostOwnerCookieOptions,
} from "@/lib/server/session";

const AcceptInviteSchema = z.object({
  token: z.string().min(40).max(64),
  password: z.string().min(14).max(128),
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
  const parsed = AcceptInviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const rateLimitAllowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "host-owner-invite-accept"),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!rateLimitAllowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  const tokenHash = hashToken(parsed.data.token);
  const invite = await store.getHostOwnerInvite(tokenHash, now);
  if (!invite) {
    return NextResponse.json(
      { error: "invite_invalid_or_expired" },
      { status: 410 },
    );
  }
  if (await store.getHostOwnerByEmail(invite.email)) {
    return NextResponse.json(
      { error: "host_owner_already_exists" },
      { status: 409 },
    );
  }

  const passwordHash = await hash(parsed.data.password, {
    algorithm: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const owner = await store.acceptHostOwnerInvite({
    tokenHash,
    passwordHash,
    now,
    auditEvent: {
      id: randomUUID(),
      actorId: invite.email,
      scope: { kind: "host", id: invite.hostId },
      action: "host.owner_invite.accepted",
      resourceType: "host_owner",
      createdAt: now,
    },
  });
  if (!owner) {
    return NextResponse.json(
      { error: "invite_invalid_or_expired" },
      { status: 410 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    getHostOwnerCookieName(),
    await createHostOwnerSession(owner.id, owner.hostId),
    hostOwnerCookieOptions(),
  );
  return response;
}
