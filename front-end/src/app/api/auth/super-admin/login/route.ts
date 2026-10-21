import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlatformStore } from "@/adapters/platform/factory";
import {
  decryptSecret,
  EncryptedSecretSchema,
  hashToken,
} from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import {
  createSuperAdminSession,
  getSessionCookieName,
  superAdminCookieOptions,
} from "@/lib/server/session";

const LoginSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^(?:\d{6}|[A-Z0-9_-]{16})$/),
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

  const store = createPlatformStore();
  const state = await store.getSetupState();
  if (!state.initialized) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const key = hashToken(
    `${createRateLimitKey(request, "super-admin-login")}:${parsed.data.email}`,
  );
  const allowed = await store.consumeRateLimit({
    key,
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const admin = await store.getSuperAdminByEmail(parsed.data.email);
  if (!admin) {
    await logAuthenticationEvent(
      store,
      "anonymous",
      "super_admin.login_failed",
    );
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const passwordValid = await verify(admin.passwordHash, parsed.data.password);
  const totpSecret = decryptSecret(
    EncryptedSecretSchema.parse(JSON.parse(admin.totpSecretCiphertext)),
  );
  const totp = new OTPAuth.TOTP({
    issuer: "Commerce Workspace",
    label: admin.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: totpSecret,
  });
  const isTotpValid =
    parsed.data.code.length === 6 &&
    totp.validate({ token: parsed.data.code, window: 1 }) !== null;
  const recoveryCodeValid =
    passwordValid &&
    parsed.data.code.length !== 6 &&
    (await store.consumeRecoveryCode(admin.id, hashToken(parsed.data.code)));
  const codeValid = isTotpValid || recoveryCodeValid;
  if (!passwordValid || !codeValid) {
    await logAuthenticationEvent(store, admin.id, "super_admin.login_failed");
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await logAuthenticationEvent(store, admin.id, "super_admin.login_succeeded");
  const token = await createSuperAdminSession(admin.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    getSessionCookieName(),
    token,
    superAdminCookieOptions(),
  );
  return response;
}

async function logAuthenticationEvent(
  store: ReturnType<typeof createPlatformStore>,
  actorId: string,
  action: string,
): Promise<void> {
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId,
    scope: { kind: "platform", id: "platform" },
    action,
    resourceType: "super_admin_auth",
    createdAt: new Date().toISOString(),
  });
}
