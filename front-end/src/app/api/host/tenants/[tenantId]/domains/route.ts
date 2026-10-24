import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getReservedPlatformDomains,
  normalizeHostDomain,
} from "@/core/domain/host-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";

const AddDomainSchema = z.object({
  domain: z.string().min(1).max(253),
});

type TenantDomainsRouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(
  request: Request,
  { params }: TenantDomainsRouteProps,
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
  const parsed = AddDomainSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const domain = normalizeHostDomain(parsed.data.domain);
  if (!domain || !domain.includes(".") || isIP(domain)) {
    return NextResponse.json(
      { error: "invalid_tenant_domain" },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "host-tenant-domain-add", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const setupState = await store.getSetupState();
  if (!setupState.platformDomain) {
    return NextResponse.json(
      { error: "platform_domain_unavailable" },
      { status: 503 },
    );
  }
  const reservedDomains = getReservedPlatformDomains(
    setupState.platformDomain,
    setupState.reservedSubdomains,
  );
  if (
    domain === normalizeHostDomain(setupState.platformDomain) ||
    reservedDomains.has(domain)
  ) {
    return NextResponse.json(
      { error: "tenant_slug_or_domain_in_use" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  try {
    const claim = await store.createTenantDomainClaim({
      hostId: session.scope.id,
      tenantId,
      domain,
      verificationToken: randomBytes(32).toString("hex"),
      createdAt: now,
      auditEvent: {
        id: randomUUID(),
        actorId: session.userId,
        scope: { kind: "host", id: session.scope.id },
        action: "tenant.domain_verification_started",
        resourceType: "tenant_domain",
        resourceId: domain,
        createdAt: now,
      },
    });
    if (!claim) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      claim,
      dns: {
        cname: { name: domain, value: setupState.platformDomain },
        txt: {
          name: `_platform-verification.${domain}`,
          value: `platform-verification=${claim.verificationToken}`,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /domain.*already exists/i.test(error.message)
    ) {
      return NextResponse.json(
        { error: "tenant_slug_or_domain_in_use" },
        { status: 409 },
      );
    }
    if (error instanceof Error && /domain limit reached/i.test(error.message)) {
      return NextResponse.json(
        { error: "custom_domain_limit_reached" },
        { status: 409 },
      );
    }
    throw error;
  }
}
