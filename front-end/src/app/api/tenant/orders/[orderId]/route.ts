import { NextResponse } from "next/server";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";

type TenantOrderRouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(
  request: Request,
  { params }: TenantOrderRouteContext,
) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { orderId } = await params;
  if (!/^ORD-[A-Fa-f0-9-]{36}$/.test(orderId)) {
    return NextResponse.json({ error: "invalid_order_id" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-order-read", session.userId),
    limit: 120,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const adapter = await createTenantOrderAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const order = await adapter.getOrder(orderId);
    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof RestBackendError) {
      return NextResponse.json(
        {
          error:
            error.status === 404 ? "order_not_found" : "tenant_backend_error",
        },
        {
          status:
            error.status >= 400 && error.status < 500 ? error.status : 502,
        },
      );
    }
    if (
      error instanceof Error &&
      error.message === "Tenant REST backend is not configured"
    ) {
      return NextResponse.json(
        { error: "connection_not_configured" },
        { status: 409 },
      );
    }
    console.error("Tenant order detail request failed", error);
    return NextResponse.json(
      { error: "tenant_backend_unavailable" },
      { status: 502 },
    );
  }
}
