import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/http";
import {
  getSessionCookieName,
  superAdminCookieOptions,
} from "@/lib/server/session";
import { createPlatformStore } from "@/adapters/platform/factory";
import { getSuperAdminSession } from "@/lib/server/session";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await getSuperAdminSession();
  if (session) {
    await createPlatformStore().appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "platform", id: "platform" },
      action: "super_admin.logout",
      resourceType: "super_admin_auth",
      createdAt: new Date().toISOString(),
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getSessionCookieName(), "", {
    ...superAdminCookieOptions(),
    maxAge: 0,
  });
  return response;
}
