import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPlatformStore } from "@/lib/server/platform";
import { isSameOrigin } from "@/lib/server/http";
import {
  getHostOwnerCookieName,
  getHostOwnerSession,
  hostOwnerCookieOptions,
} from "@/lib/server/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await getHostOwnerSession();
  if (session) {
    await getPlatformStore().appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "host.owner_logout",
      resourceType: "host_owner_auth",
      createdAt: new Date().toISOString(),
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getHostOwnerCookieName(), "", {
    ...hostOwnerCookieOptions(),
    maxAge: 0,
  });
  return response;
}
