import { NextResponse } from "next/server";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { TenantDataBackendError } from "@/core/ports/data";
import { canAccessPermission } from "@/core/tenancy/scope";
import { cancelCustomerCodOrder } from "@/lib/server/cancel-customer-cod-order";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";

type CancelOrderRouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  request: Request,
  { params }: CancelOrderRouteProps,
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { orderId } = await params;
  if (!/^ORD-[A-Fa-f0-9-]{36}$/.test(orderId)) {
    return NextResponse.json({ error: "invalid_order_id" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "customer-order-cancel", session.userId),
    limit: 10,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const result = await cancelCustomerCodOrder({
      store,
      tenantId: session.scope.id,
      hostId: session.scope.hostId,
      customerId: session.userId,
      orderId,
      actorId: session.userId,
      scope: session.scope,
      auditAction: "customer.order.cod_cancelled",
    });
    if ("error" in result) {
      const status = result.error === "order_not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ order: result.order });
  } catch (error) {
    if (error instanceof RestBackendError && error.status === 409) {
      return NextResponse.json(
        { error: "order_not_cancellable" },
        { status: 409 },
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
    if (error instanceof TenantDataBackendError) {
      console.error("Customer COD order cancellation failed", error);
      return NextResponse.json(
        { error: "cancellation_backend_unavailable" },
        { status: 502 },
      );
    }
    console.error("Customer COD order cancellation failed", error);
    return NextResponse.json(
      { error: "cancellation_failed" },
      { status: 500 },
    );
  }
}
