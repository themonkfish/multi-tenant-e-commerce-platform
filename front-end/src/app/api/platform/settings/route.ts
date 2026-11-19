import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PlatformSettingsSchema } from "@/core/domain/platform-settings";
import { canAccessPermission } from "@/core/tenancy/scope";
import { isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

export async function GET() {
  const session = await getSuperAdminSession();
  if (!session || session.scope.kind !== "platform") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "platform:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const state = await getPlatformStore().getSetupState();
  return NextResponse.json({ settings: state.settings });
}

export async function PATCH(request: Request) {
  const session = await getSuperAdminSession();
  if (!session || session.scope.kind !== "platform") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "platform:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PlatformSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const settings = await getPlatformStore().updatePlatformSettings(
    parsed.data,
    {
      id: randomUUID(),
      actorId: session.userId,
      scope: { kind: "platform", id: "platform" },
      action: "platform.settings.updated",
      resourceType: "platform_settings",
      createdAt: now,
    },
  );
  return NextResponse.json({ settings });
}
