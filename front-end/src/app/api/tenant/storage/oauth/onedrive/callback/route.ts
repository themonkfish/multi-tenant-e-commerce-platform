import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getServerEnv } from "@/lib/server/env";
import { getTenantOwnerSession } from "@/lib/server/session";

function verifyState(state: string, secret: string) {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const parsed = z
      .object({
        tenantId: z.uuid(),
        hostId: z.uuid(),
        folderId: z.string().min(1).max(512),
        nonce: z.string().min(1).max(64),
        issuedAt: z.number().int().positive(),
      })
      .safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    if (Date.now() - parsed.data.issuedAt > 10 * 60 * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const env = getServerEnv();
  if (!state || !code) {
    return NextResponse.json({ error: "invalid_oauth_callback" }, { status: 400 });
  }
  const stateData = verifyState(state, env.SESSION_SECRET!);
  if (
    !stateData ||
    stateData.tenantId !== session.scope.id ||
    stateData.hostId !== session.scope.hostId
  ) {
    return NextResponse.json({ error: "invalid_oauth_state" }, { status: 400 });
  }
  if (!env.ONEDRIVE_CLIENT_ID || !env.ONEDRIVE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "onedrive_oauth_not_configured" },
      { status: 503 },
    );
  }
  const tenantId = env.ONEDRIVE_TENANT_ID ?? "common";
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        client_id: env.ONEDRIVE_CLIENT_ID,
        client_secret: env.ONEDRIVE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: new URL(
          "/api/tenant/storage/oauth/onedrive/callback",
          url.origin,
        ).toString(),
        scope: "offline_access Files.ReadWrite User.Read",
      }),
    },
  );
  const tokenBody = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (
    !tokenResponse.ok ||
    !tokenBody?.access_token ||
    !tokenBody.refresh_token
  ) {
    return NextResponse.json({ error: "onedrive_oauth_failed" }, { status: 502 });
  }
  const profileResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName",
    {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const profile = (await profileResponse.json().catch(() => null)) as {
    userPrincipalName?: string;
  } | null;
  const accountEmail = z.email().safeParse(profile?.userPrincipalName);
  if (!profileResponse.ok || !accountEmail.success) {
    return NextResponse.json(
      { error: "onedrive_account_lookup_failed" },
      { status: 502 },
    );
  }
  const store = getPlatformStore();
  const secretRef = await getSecretVault().putSecret({
    tenantId: session.scope.id,
    name: "tenant-onedrive-oauth",
    value: JSON.stringify({
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      expiresAt: Date.now() + (tokenBody.expires_in ?? 3600) * 1000,
    }),
  });
  const existing = await store.getTenantStorageProvider(
    session.scope.id,
    session.scope.hostId,
  );
  const now = new Date().toISOString();
  const saved = await store.updateTenantStorageProvider({
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    config: {
      type: "onedrive",
      folderId: stateData.folderId,
      oauthTokenRef: secretRef,
      accountEmail: accountEmail.data,
    },
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.storage_provider.onedrive_authorized",
      resourceType: "tenant_storage_provider",
      resourceId: session.scope.id,
      createdAt: now,
    },
  });
  if (!saved) {
    await getSecretVault().deleteSecret(secretRef);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing) {
    try {
      await getSecretVault().deleteSecret(
        existing.type === "gdrive" ||
          existing.type === "dropbox" ||
          existing.type === "onedrive"
          ? existing.oauthTokenRef
          : existing.credentialsRef,
      );
    } catch {}
  }
  return NextResponse.redirect(new URL("/en/tenant", url.origin));
}
