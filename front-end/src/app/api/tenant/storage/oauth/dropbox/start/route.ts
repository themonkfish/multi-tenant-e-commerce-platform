import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import { getServerEnv } from "@/lib/server/env";
import { getTenantOwnerSession } from "@/lib/server/session";

export async function GET(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId")?.trim();
  if (!folderId || folderId.length > 512) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const env = getServerEnv();
  if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET) {
    return NextResponse.json(
      { error: "dropbox_oauth_not_configured" },
      { status: 503 },
    );
  }
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      folderId,
      nonce,
      issuedAt: Date.now(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
  const callback = new URL(
    "/api/tenant/storage/oauth/dropbox/callback",
    url.origin,
  );
  const authorization = new URL("https://www.dropbox.com/oauth2/authorize");
  authorization.searchParams.set("client_id", env.DROPBOX_APP_KEY);
  authorization.searchParams.set("redirect_uri", callback.toString());
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("token_access_type", "offline");
  authorization.searchParams.set("state", `${payload}.${signature}`);
  return NextResponse.redirect(authorization.toString());
}
