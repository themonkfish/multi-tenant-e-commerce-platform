import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  CreateTenantInputSchema,
  TenantRecordSchema,
} from "@/core/domain/host-portal";
import { normalizeHostDomain } from "@/core/domain/host-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";

export async function POST(request: Request) {
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const store = getPlatformStore();
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateTenantInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "host-tenant-create", session.userId),
    limit: 20,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const normalizedDomains = [
    ...new Set(parsed.data.domains.map(normalizeHostDomain)),
  ];
  if (normalizedDomains.some((domain) => domain === null)) {
    return NextResponse.json(
      { error: "invalid_tenant_domain" },
      { status: 400 },
    );
  }
  const domains = normalizedDomains.filter(
    (domain): domain is string => domain !== null,
  );
  const hosts = await store.listHosts();
  const host = hosts.find((candidate) => candidate.id === session.scope.id);
  if (!host || host.status !== "active") {
    return NextResponse.json({ error: "host_unavailable" }, { status: 403 });
  }

  const state = await store.getSetupState();
  const reservedDomains = new Set(
    state.reservedSubdomains.map((subdomain) =>
      state.platformDomain
        ? `${subdomain.toLowerCase()}.${state.platformDomain.toLowerCase()}`
        : "",
    ),
  );
  const currentTenants = await store.listTenantsForHost(host.id);
  const allTenants = (
    await Promise.all(hosts.map((entry) => store.listTenantsForHost(entry.id)))
  ).flat();
  const existingDomains = new Set([
    ...hosts.flatMap((entry) => entry.domains),
    ...allTenants.flatMap((tenant) => tenant.domains),
  ]);
  if (
    domains.some(
      (domain) =>
        existingDomains.has(domain) ||
        domain === state.platformDomain ||
        reservedDomains.has(domain),
    )
  ) {
    return NextResponse.json(
      { error: "tenant_slug_or_domain_in_use" },
      { status: 409 },
    );
  }

  const currentDomainCount =
    host.domains.length +
    currentTenants.reduce((total, tenant) => total + tenant.domains.length, 0);
  if (currentTenants.length >= host.limits.maxTenants) {
    return NextResponse.json(
      { error: "tenant_limit_reached" },
      { status: 409 },
    );
  }
  if (currentDomainCount + domains.length > host.limits.maxCustomDomains) {
    return NextResponse.json(
      { error: "custom_domain_limit_reached" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const tenant = TenantRecordSchema.parse({
    id: randomUUID(),
    hostId: host.id,
    slug: parsed.data.slug,
    name: parsed.data.name,
    status: "pending",
    plan: parsed.data.plan,
    domains,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await store.createTenantForHost(tenant, {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "host", id: host.id },
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant.id,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof Error && /limit reached/i.test(error.message)) {
      return NextResponse.json(
        {
          error: error.message.includes("domain")
            ? "custom_domain_limit_reached"
            : "tenant_limit_reached",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && /already exists/i.test(error.message)) {
      return NextResponse.json(
        { error: "tenant_slug_or_domain_in_use" },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ tenant }, { status: 201 });
}
