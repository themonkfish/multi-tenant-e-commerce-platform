import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import {
  createHostOwnerSession,
  getHostOwnerCookieName,
  hostOwnerCookieOptions,
} from "@/lib/server/session";
import { hashToken } from "@/lib/server/crypto";

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
      `${createRateLimitKey(request, "host-owner-login")}:${parsed.data.email}`,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const owner = await store.getHostOwnerByEmail(parsed.data.email);
  const passwordValid = owner
    ? await verify(owner.passwordHash, parsed.data.password)
    : false;
  const host = owner
    ? (await store.listHosts()).find(
        (candidate) => candidate.id === owner.hostId,
      )
    : null;
  if (!owner || !passwordValid || !host || host.status !== "active") {
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: owner?.id ?? "anonymous",
      scope: {
        kind: "platform",
        id: "platform",
      },
      action: "host.owner_login.failed",
      resourceType: "host_owner_auth",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const now = new Date().toISOString();
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: owner.id,
    scope: { kind: "host", id: owner.hostId },
    action: "host.owner_login.succeeded",
    resourceType: "host_owner_auth",
    createdAt: now,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    getHostOwnerCookieName(),
    await createHostOwnerSession(owner.id, owner.hostId),
    hostOwnerCookieOptions(),
  );
  return response;
}
