import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export async function GET(request: Request) {
  const session = await getSuperAdminSession();
  if (!session || session.scope.kind !== "platform") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "platform:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
  }
  const events = await getPlatformStore().listAuditEvents({
    scope: session.scope,
    limit: parsed.data.limit,
  });
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      scope: session.scope,
      events,
    },
    null,
    2,
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition":
        'attachment; filename="platform-audit-events.json"',
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
