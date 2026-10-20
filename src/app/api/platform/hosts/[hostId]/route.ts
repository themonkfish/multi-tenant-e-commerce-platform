import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HostStatusSchema } from "@/core/domain/host-config";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";
import { z } from "zod";

const UpdateHostSchema = z.object({ status: HostStatusSchema });

type HostRouteProps = {
  params: Promise<{ hostId: string }>;
};

export async function PATCH(request: Request, { params }: HostRouteProps) {
  const session = await getSuperAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const parsed = UpdateHostSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "platform-host-update"),
    limit: 20,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const now = new Date().toISOString();
  const host = await store.updateHostStatus(hostId, parsed.data.status, now, {
    id: randomUUID(),
    actorId: session.userId,
    scope: { kind: "platform", id: "platform" },
    action:
      parsed.data.status === "suspended" ? "host.suspended" : "host.activated",
    resourceType: "host",
    resourceId: hostId,
    createdAt: now,
  });
  if (!host) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ host });
}
