import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import { getServerEnv } from "@/lib/server/env";
import { enqueueBackgroundEvent } from "@/lib/server/inngest";

const RequestResetSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
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
  const parsed = RequestResetSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }
  const scope = await getRequestDomainScope();
  if (scope?.kind !== "tenant") {
    return NextResponse.json({ ok: true });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: hashToken(
      `${createRateLimitKey(request, "customer-password-reset-request")}:${scope.tenant.id}:${parsed.data.email}`,
    ),
    limit: 5,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const account = await store.getCustomerAccountByEmail(
    scope.tenant.id,
    parsed.data.email,
  );
  if (account) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    await store.createCustomerPasswordReset({
      id: randomUUID(),
      tenantId: scope.tenant.id,
      customerId: account.id,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: now.toISOString(),
    });
    const env = getServerEnv();
    const platformDomain = env.NEXT_PUBLIC_PLATFORM_DOMAIN;
    if (platformDomain) {
      const resetUrl = `https://${platformDomain}/${new URL(request.url).pathname.split("/")[1]}/customer/password-reset?tenant=${scope.tenant.id}&token=${encodeURIComponent(token)}`;
      await enqueueBackgroundEvent({
        name: "email/password-reset.requested",
        data: {
          to: account.email,
          resetUrl,
          expiresAt,
        },
      }).catch(() => undefined);
    }
  }
  return NextResponse.json({ ok: true });
}
