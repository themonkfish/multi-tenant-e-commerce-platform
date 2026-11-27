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
  const parsed = z
    .object({
      folderId: z.string().trim().min(1).max(512),
      accountEmail: z.email(),
    })
    .safeParse({
      folderId: url.searchParams.get("folderId"),
      accountEmail: url.searchParams.get("accountEmail"),
    });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const env = getServerEnv();
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "google_drive_oauth_not_configured" },
      { status: 503 },
    );
  }
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      folderId: parsed.data.folderId,
      accountEmail: parsed.data.accountEmail,
      nonce,
      issuedAt: Date.now(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
  const state = `${payload}.${signature}`;
  const callback = new URL(
    "/api/tenant/storage/oauth/google-drive/callback",
    url.origin,
  );
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", env.GOOGLE_DRIVE_CLIENT_ID);
  authorization.searchParams.set("redirect_uri", callback.toString());
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("state", state);
  return NextResponse.redirect(authorization.toString());
}
