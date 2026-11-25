import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeCustomDomain } from "@/core/domain/host-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";
import { verifyTenantDomainDns } from "@/lib/server/tenant-domain-verification";
import { attachVercelDomain } from "@/lib/server/vercel-domains";

const VerifyDomainSchema = z.object({
  domain: z.string().min(1).max(253),
});

type VerifyTenantDomainRouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(
  request: Request,
  { params }: VerifyTenantDomainRouteProps,
) {
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    !canAccessPermission(session, "tenant:write", {
      kind: "tenant",
      id: tenantId,
      hostId: session.scope.id,
    })
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = VerifyDomainSchema.safeParse(rawBody);
  const domain = parsed.success
    ? normalizeCustomDomain(parsed.data.domain)
    : null;
  if (!domain) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "host-tenant-domain-verify",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const claims = await store.listTenantDomainClaims(session.scope.id);
  const claim = claims.find(
    (candidate) =>
      candidate.tenantId === tenantId && candidate.domain === domain,
  );
  if (!claim) {
    return NextResponse.json(
      { error: "domain_claim_not_found" },
      { status: 404 },
    );
  }
  const setupState = await store.getSetupState();
  if (!setupState.platformDomain) {
    return NextResponse.json(
      { error: "platform_domain_unavailable" },
      { status: 503 },
    );
  }

  let verified: boolean;
  try {
    verified = await verifyTenantDomainDns(
      domain,
      setupState.platformDomain,
      claim.verificationToken,
    );
  } catch {
    return NextResponse.json({ error: "dns_lookup_failed" }, { status: 503 });
  }
  if (!verified) {
    return NextResponse.json(
      { error: "domain_dns_not_ready" },
      { status: 409 },
    );
  }

  try {
    await attachVercelDomain(domain);
  } catch (error) {
    console.error("Vercel tenant-domain attachment failed", {
      domain,
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "provider_domain_attach_failed" },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  const tenant = await store.completeTenantDomainClaim({
    hostId: session.scope.id,
    tenantId,
    domain,
    verificationToken: claim.verificationToken,
    updatedAt: now,
    auditEvent: {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "host", id: session.scope.id },
      action: "tenant.domain_verified",
      resourceType: "tenant_domain",
      resourceId: domain,
      createdAt: now,
    },
  });
  if (!tenant) {
    return NextResponse.json(
      { error: "domain_claim_not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ tenant });
}
