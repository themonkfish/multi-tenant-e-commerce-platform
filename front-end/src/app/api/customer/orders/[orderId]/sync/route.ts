import { NextResponse } from "next/server";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";

type SyncOrderRouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: Request, { params }: SyncOrderRouteProps) {
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
  const store = getPlatformStore();
  const order = (
    await store.listCustomerOrders(session.scope.id, session.userId)
  ).find((candidate) => candidate.id === orderId);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (order.paymentStatus !== "paid") {
    return NextResponse.json({ error: "payment_required" }, { status: 409 });
  }
  if (order.backendSyncStatus === "synced") {
    return NextResponse.json({ order });
  }

  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "customer-order-sync-retry",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const syncedOrder = await syncCustomerOrderToTenant({
    store,
    tenantId: session.scope.id,
    hostId: session.scope.hostId,
    order,
  });
  return NextResponse.json({ order: syncedOrder });
}
