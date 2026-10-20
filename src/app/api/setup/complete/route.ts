import { randomBytes, randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EncryptedSecretSchema,
  decryptSecret,
  hashToken,
  timingSafeStringEqual,
} from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getServerEnv } from "@/lib/server/env";
import { getPlatformStore } from "@/lib/server/platform";

const CompleteSchema = z.object({
  setupToken: z.string().min(32),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
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
  const parsed = CompleteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const env = getServerEnv();
  const store = getPlatformStore();
  const state = await store.getSetupState();
  if (state.initialized) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!env.SETUP_TOKEN) {
    return NextResponse.json(
      { error: "setup_token_not_configured" },
      { status: 503 },
    );
  }
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "setup-complete"),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!timingSafeStringEqual(parsed.data.setupToken, env.SETUP_TOKEN)) {
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: "anonymous",
      scope: { kind: "platform", id: "platform" },
      action: "platform.bootstrap.rejected",
      resourceType: "platform",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

  const tokenHash = hashToken(parsed.data.setupToken);
  const admin = await store.getBootstrapAdmin(tokenHash, parsed.data.email);
  if (!admin) {
    return NextResponse.json({ error: "setup_not_available" }, { status: 404 });
  }

  const encryptedSecret = EncryptedSecretSchema.parse(
    JSON.parse(admin.totpSecretCiphertext),
  );
  const secret = decryptSecret(encryptedSecret);
  const totp = new OTPAuth.TOTP({
    issuer: "Commerce Workspace",
    label: admin.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  if (totp.validate({ token: parsed.data.code, window: 1 }) === null) {
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: admin.id,
      scope: { kind: "platform", id: "platform" },
      action: "platform.bootstrap.totp_verification_failed",
      resourceType: "platform",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "invalid_totp_code" }, { status: 401 });
  }

  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(12).toString("base64url").toUpperCase(),
  );
  await store.completeBootstrap({
    setupTokenHash: tokenHash,
    email: admin.email,
    recoveryCodeHashes: recoveryCodes.map(hashToken),
    auditEvent: {
      id: randomUUID(),
      actorId: admin.id,
      scope: { kind: "platform", id: "platform" },
      action: "platform.bootstrap.completed",
      resourceType: "platform",
      createdAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ recoveryCodes });
}
