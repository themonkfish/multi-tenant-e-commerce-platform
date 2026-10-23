import { hash, verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlatformStore } from "@/adapters/platform/factory";
import {
  normalizeHostDomain,
  normalizeReservedSubdomains,
} from "@/core/domain/host-config";
import {
  decryptSecret,
  EncryptedSecretSchema,
  encryptSecret,
  hashToken,
  timingSafeStringEqual,
} from "@/lib/server/crypto";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getServerEnv } from "@/lib/server/env";

const BootstrapSchema = z.object({
  setupToken: z.string().min(32),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(14).max(128),
  platformDomain: z.string().min(1).max(253),
  reservedSubdomains: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/),
    )
    .max(32)
    .default(["admin", "www", "api"]),
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
  const parsed = BootstrapSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const store = createPlatformStore();
  const state = await store.getSetupState();
  if (state.initialized) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const env = getServerEnv();
  if (!env.SETUP_TOKEN) {
    return NextResponse.json(
      { error: "setup_token_not_configured" },
      { status: 503 },
    );
  }

  const rateLimitAllowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "setup-bootstrap"),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!rateLimitAllowed) {
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

  const domain = normalizeHostDomain(parsed.data.platformDomain);
  if (!domain) {
    return NextResponse.json(
      { error: "invalid_platform_domain" },
      { status: 400 },
    );
  }

  const reservedSubdomains = normalizeReservedSubdomains(
    parsed.data.reservedSubdomains,
  );
  if (reservedSubdomains.some((subdomain) => subdomain === domain)) {
    return NextResponse.json(
      { error: "invalid_reserved_subdomain" },
      { status: 400 },
    );
  }

  const tokenHash = hashToken(parsed.data.setupToken);
  let admin = await store.getBootstrapAdmin(tokenHash, parsed.data.email);
  if (admin) {
    const validPassword = await verify(
      admin.passwordHash,
      parsed.data.password,
    );
    if (!validPassword) {
      return NextResponse.json(
        { error: "bootstrap_already_started" },
        { status: 409 },
      );
    }
  } else {
    const totpSecret = new OTPAuth.Secret({ size: 20 });
    const now = new Date().toISOString();
    const passwordHash = await hash(parsed.data.password, {
      algorithm: 2,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    admin = {
      id: randomUUID(),
      email: parsed.data.email,
      passwordHash,
      totpSecretCiphertext: JSON.stringify(encryptSecret(totpSecret.base32)),
      recoveryCodeHashes: [],
      createdAt: now,
    };

    try {
      await store.createInitialSuperAdmin({
        setupTokenHash: tokenHash,
        platformDomain: domain,
        reservedSubdomains,
        superAdmin: admin,
      });
    } catch (error) {
      const resumableAdmin = await store.getBootstrapAdmin(
        tokenHash,
        parsed.data.email,
      );
      if (!resumableAdmin) {
        throw error;
      }
      admin = resumableAdmin;
    }
  }

  const base32Secret = decryptSecret(
    EncryptedSecretSchema.parse(JSON.parse(admin.totpSecretCiphertext)),
  );
  const totp = new OTPAuth.TOTP({
    issuer: "Commerce Workspace",
    label: admin.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: base32Secret,
  });
  const otpauthUrl = totp.toString();
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: admin.id,
    scope: { kind: "platform", id: "platform" },
    action: "platform.bootstrap.totp_enrollment_started",
    resourceType: "platform",
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({
    email: admin.email,
    secret: base32Secret,
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
  });
}
