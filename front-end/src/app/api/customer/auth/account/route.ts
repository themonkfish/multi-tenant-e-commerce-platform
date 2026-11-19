import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import {
  customerCookieOptions,
  getCustomerCookieName,
  getCustomerSession,
} from "@/lib/server/session";
import { canAccessPermission } from "@/core/tenancy/scope";

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "customer-account-delete", session.userId),
    limit: 3,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const deleted = await store.deleteCustomerAccount(
    session.scope.id,
    session.userId,
  );
  if (!deleted) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: session.scope,
    action: "customer.account.deleted",
    resourceType: "customer_account",
    resourceId: session.userId,
    createdAt: new Date().toISOString(),
  });
  const response = NextResponse.json({ deleted: true });
  response.cookies.set(getCustomerCookieName(), "", {
    ...customerCookieOptions(),
    maxAge: 0,
  });
  return response;
}
