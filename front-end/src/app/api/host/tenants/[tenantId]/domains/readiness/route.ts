import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";
import { checkTenantDomainReadiness } from "@/lib/server/tenant-domain-readiness";

const ReadinessSchema = z.object({
  domain: z.string().min(1).max(253),
});

type TenantDomainReadinessRouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(
  request: Request,
  { params }: TenantDomainReadinessRouteProps,
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
  const parsed = ReadinessSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "host-tenant-domain-readiness",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const tenant = (await store.listTenantsForHost(session.scope.id)).find(
    (candidate) =>
      candidate.id === tenantId &&
      candidate.domains.includes(parsed.data.domain),
  );
  if (!tenant) {
    return NextResponse.json(
      { error: "verified_domain_not_found" },
      { status: 404 },
    );
  }

  const readiness = await checkTenantDomainReadiness(parsed.data.domain);
  return NextResponse.json({ domain: parsed.data.domain, readiness });
}
