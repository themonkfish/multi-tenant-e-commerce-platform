import { hash } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/server/crypto";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import { isSameOrigin } from "@/lib/server/http";

const ResetSchema = z.object({
  tenantId: z.uuid(),
  token: z.string().min(32).max(512),
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
  const parsed = ResetSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const scope = await getRequestDomainScope();
  if (
    scope?.kind !== "tenant" ||
    scope.tenant.id !== parsed.data.tenantId
  ) {
    return NextResponse.json({ error: "invalid_reset" }, { status: 400 });
  }
  const account = await getPlatformStore().consumeCustomerPasswordReset({
    tenantId: parsed.data.tenantId,
    tokenHash: hashToken(parsed.data.token),
    passwordHash: await hash(parsed.data.password),
    now: new Date().toISOString(),
  });
  if (!account) {
    return NextResponse.json({ error: "invalid_reset" }, { status: 400 });
  }
  await getPlatformStore().appendAuditEvent({
    id: crypto.randomUUID(),
    actorId: account.id,
    scope: scope.scope,
    action: "customer.password_reset.completed",
    resourceType: "customer_account",
    resourceId: account.id,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
