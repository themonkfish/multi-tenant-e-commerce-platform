import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  CreateHostInputSchema,
  HostConfigSchema,
  normalizeHostDomain,
} from "@/core/domain/host-config";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

export async function POST(request: Request) {
  const session = await getSuperAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const parsed = CreateHostInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "platform-host-create", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const domains = parsed.data.domains.map(normalizeHostDomain);
  if (domains.some((domain) => domain === null)) {
    return NextResponse.json({ error: "invalid_host_domain" }, { status: 400 });
  }
  const normalizedDomains = [
    ...new Set(domains.filter((domain): domain is string => domain !== null)),
  ];
  if (normalizedDomains.length > parsed.data.maxCustomDomains) {
    return NextResponse.json(
      { error: "host_domain_limit_exceeded" },
      { status: 400 },
    );
  }
  const state = await store.getSetupState();
  if (
    state.reservedSubdomains.some(
      (reserved) => reserved.toLowerCase() === parsed.data.slug,
    )
  ) {
    return NextResponse.json({ error: "reserved_host_slug" }, { status: 409 });
  }

  const existingHosts = await store.listHosts();
  const existingDomains = new Set(
    existingHosts.flatMap((host) => host.domains),
  );
  const reservedDomains = new Set(
    state.reservedSubdomains.map((subdomain) =>
      state.platformDomain
        ? `${subdomain.toLowerCase()}.${state.platformDomain.toLowerCase()}`
        : "",
    ),
  );
  if (
    normalizedDomains.some(
      (domain) =>
        existingDomains.has(domain) ||
        domain === state.platformDomain ||
        reservedDomains.has(domain),
    )
  ) {
    return NextResponse.json({ error: "host_domain_in_use" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const host = HostConfigSchema.parse({
    id: randomUUID(),
    slug: parsed.data.slug,
    name: parsed.data.name,
    status: "pending",
    plan: parsed.data.plan,
    limits: {
      maxTenants: parsed.data.maxTenants,
      maxCustomDomains: parsed.data.maxCustomDomains,
      features: {},
    },
    branding: { name: parsed.data.name },
    domains: normalizedDomains,
    ...(parsed.data.supportContact
      ? { supportContact: parsed.data.supportContact }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  try {
    await store.createHost(host, {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "platform", id: "platform" },
      action: "host.created",
      resourceType: "host",
      resourceId: host.id,
      createdAt: now,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /already exists|already exist/i.test(error.message)
    ) {
      return NextResponse.json(
        { error: "host_slug_or_domain_in_use" },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ host }, { status: 201 });
}
