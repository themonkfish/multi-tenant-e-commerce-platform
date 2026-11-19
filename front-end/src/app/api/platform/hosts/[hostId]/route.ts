import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getReservedPlatformDomains,
  HostStatusSchema,
  normalizeHostDomain,
  UpdateHostInputSchema,
} from "@/core/domain/host-config";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";
import { z } from "zod";

const UpdateHostStatusSchema = z.object({ status: HostStatusSchema });

type HostRouteProps = {
  params: Promise<{ hostId: string }>;
};

export async function PATCH(request: Request, { params }: HostRouteProps) {
  const session = await getSuperAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "platform:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { hostId } = await params;
  if (!z.uuid().safeParse(hostId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const statusParsed = UpdateHostStatusSchema.safeParse(rawBody);
  const detailsParsed = UpdateHostInputSchema.safeParse(rawBody);
  if (!statusParsed.success && !detailsParsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "platform-host-update", session.userId),
    limit: 20,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  if (detailsParsed.success) {
    const domains = detailsParsed.data.domains.map(normalizeHostDomain);
    if (domains.some((domain) => domain === null)) {
      return NextResponse.json(
        { error: "invalid_host_domain" },
        { status: 400 },
      );
    }
    const normalizedDomains = [
      ...new Set(domains.filter((domain): domain is string => domain !== null)),
    ];
    if (normalizedDomains.length > detailsParsed.data.maxCustomDomains) {
      return NextResponse.json(
        { error: "host_domain_limit_exceeded" },
        { status: 400 },
      );
    }

    const state = await store.getSetupState();
    const currentHost = await store.getHostById(hostId);
    if (!currentHost) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (
      currentHost.slug !== detailsParsed.data.slug &&
      state.reservedSubdomains.some(
        (reserved) =>
          reserved.toLowerCase() === detailsParsed.data.slug.toLowerCase(),
      )
    ) {
      return NextResponse.json(
        { error: "reserved_host_slug" },
        { status: 409 },
      );
    }

    const existingHosts = await store.listHosts();
    const duplicateSlug = existingHosts.some(
      (host) => host.id !== hostId && host.slug === detailsParsed.data.slug,
    );
    const existingDomains = new Set(
      existingHosts.flatMap((host) => (host.id === hostId ? [] : host.domains)),
    );
    const reservedDomains = getReservedPlatformDomains(
      state.platformDomain ?? null,
      state.reservedSubdomains,
    );
    if (
      duplicateSlug ||
      normalizedDomains.some(
        (domain) =>
          existingDomains.has(domain) ||
          domain === state.platformDomain ||
          reservedDomains.has(domain),
      )
    ) {
      return NextResponse.json(
        { error: "host_slug_or_domain_in_use" },
        { status: 409 },
      );
    }

    try {
      const host = await store.updateHost(
        hostId,
        { ...detailsParsed.data, domains: normalizedDomains },
        now,
        {
          id: randomUUID(),
          actorId: session.userId,
          scope: { kind: "platform", id: "platform" },
          action: "host.updated",
          resourceType: "host",
          resourceId: hostId,
          createdAt: now,
        },
      );
      if (!host) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ host });
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
  }

  if (!statusParsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const host = await store.updateHostStatus(
    hostId,
    statusParsed.data.status,
    now,
    {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "platform", id: "platform" },
      action:
        statusParsed.data.status === "suspended"
          ? "host.suspended"
          : "host.activated",
      resourceType: "host",
      resourceId: hostId,
      createdAt: now,
    },
  );
  if (!host) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ host });
}

export async function DELETE(request: Request, { params }: HostRouteProps) {
  const session = await getSuperAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "platform:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { hostId } = await params;
  if (!z.uuid().safeParse(hostId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "platform-host-delete", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  const result = await store.deleteHost(hostId, {
    id: randomUUID(),
    actorId: session.userId,
    scope: { kind: "platform", id: "platform" },
    action: "host.deleted",
    resourceType: "host",
    resourceId: hostId,
    createdAt: now,
  });
  if (result === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result === "host_has_tenants") {
    return NextResponse.json({ error: "host_has_tenants" }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
