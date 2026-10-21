import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import {
  createCustomerSession,
  customerCookieOptions,
  getCustomerCookieName,
} from "@/lib/server/session";

const RegisterSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
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
  const parsed = RegisterSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const scope = await getRequestDomainScope();
  if (scope?.kind !== "tenant") {
    return NextResponse.json({ error: "tenant_unavailable" }, { status: 404 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: hashToken(
      `${createRateLimitKey(request, "customer-register")}:${scope.tenant.id}`,
    ),
    limit: 5,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const account = await store.createCustomerAccount({
      id: randomUUID(),
      tenantId: scope.tenant.id,
      email: parsed.data.email,
      passwordHash: await hash(parsed.data.password),
      createdAt: new Date().toISOString(),
    });
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: account.id,
      scope: scope.scope,
      action: "customer.account.created",
      resourceType: "customer_account",
      resourceId: account.id,
      createdAt: new Date().toISOString(),
    });
    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(
      getCustomerCookieName(),
      await createCustomerSession(account.id, account.tenantId),
      customerCookieOptions(),
    );
    return response;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "A customer account already exists for this email"
    ) {
      return NextResponse.json({ error: "account_exists" }, { status: 409 });
    }
    throw error;
  }
}
