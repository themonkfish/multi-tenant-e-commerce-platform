import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import {
  getTenantOwnerCookieName,
  getTenantOwnerSession,
  tenantOwnerCookieOptions,
} from "@/lib/server/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await getTenantOwnerSession();
  if (session) {
    await getPlatformStore().appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.owner_logout",
      resourceType: "tenant_owner_auth",
      createdAt: new Date().toISOString(),
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getTenantOwnerCookieName(), "", {
    ...tenantOwnerCookieOptions(),
    maxAge: 0,
  });
  return response;
}
