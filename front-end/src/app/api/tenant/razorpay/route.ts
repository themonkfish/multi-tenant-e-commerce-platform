import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

const RazorpayInputSchema = z
  .object({
    keyId: z
      .string()
      .trim()
      .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/),
    keySecret: z.string().trim().min(1).max(2048).optional(),
    webhookSecret: z.string().trim().min(16).max(2048).optional(),
  })
  .strict();

export async function GET() {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const settings = await getPlatformStore().getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const config = settings.payments.razorpayConfig;
  return NextResponse.json({
    connection: config
      ? { keyId: config.keyId, credentialsConfigured: true }
      : null,
  });
}

export async function PUT(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
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
  const parsed = RazorpayInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-razorpay-config", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const existing = settings.payments.razorpayConfig;
  if (!parsed.data.keySecret || !parsed.data.webhookSecret) {
    if (!existing) {
      return NextResponse.json(
        { error: "razorpay_credentials_required" },
        { status: 400 },
      );
    }
  }
  const vault = getSecretVault();
  let credentialsRef = existing?.credentialsRef;
  let newRef: string | undefined;
  if (parsed.data.keySecret && parsed.data.webhookSecret) {
    newRef = await vault.putSecret({
      tenantId: session.scope.id,
      name: "tenant-razorpay-credentials",
      value: JSON.stringify({
        keyId: parsed.data.keyId,
        keySecret: parsed.data.keySecret,
        webhookSecret: parsed.data.webhookSecret,
      }),
    });
    credentialsRef = newRef;
  }
  if (!credentialsRef) {
    return NextResponse.json(
      { error: "razorpay_credentials_required" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const saved = await store.updateTenantStoreSettings({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    settings: {
      ...settings,
      payments: {
        ...settings.payments,
        razorpay: true,
        razorpayConfig: {
          keyId: parsed.data.keyId,
          credentialsRef,
        },
      },
    },
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.razorpay.updated",
      resourceType: "tenant_razorpay",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!saved) {
    if (newRef) await vault.deleteSecret(newRef);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (newRef && existing && existing.credentialsRef !== newRef) {
    try {
      await vault.deleteSecret(existing.credentialsRef);
    } catch {
      // The replacement remains usable; stale cleanup can be retried separately.
    }
  }
  return NextResponse.json({
    connection: { keyId: parsed.data.keyId, credentialsConfigured: true },
  });
}

export async function DELETE(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const store = getPlatformStore();
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const existing = settings.payments.razorpayConfig;
  if (!existing) {
    return NextResponse.json(
      { error: "razorpay_not_configured" },
      { status: 404 },
    );
  }
  const now = new Date().toISOString();
  const saved = await store.updateTenantStoreSettings({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    settings: {
      ...settings,
      payments: {
        ...settings.payments,
        razorpay: false,
        razorpayConfig: undefined,
      },
    },
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.razorpay.deleted",
      resourceType: "tenant_razorpay",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!saved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await getSecretVault().deleteSecret(existing.credentialsRef);
  return NextResponse.json({ connection: null });
}
