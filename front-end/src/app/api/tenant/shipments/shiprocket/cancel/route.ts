import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";
import { getServerEnv } from "@/lib/server/env";
import { cancelShiprocketShipment } from "@/lib/server/shiprocket-shipments";

const CancellationRequestSchema = z
  .object({ orderId: z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/) })
  .strict();

export async function POST(request: Request) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "orders:write")) {
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
  const parsed = CancellationRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const env = getServerEnv();
  if (
    !env.SHIPROCKET_API_EMAIL ||
    !env.SHIPROCKET_API_PASSWORD ||
    !env.SHIPROCKET_PICKUP_LOCATION
  ) {
    return NextResponse.json(
      { error: "shiprocket_credentials_required" },
      { status: 409 },
    );
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-shiprocket-cancellation",
      session.userId,
    ),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const order = (await store.listTenantOrders(session.scope.id)).find(
    (candidate) => candidate.id === parsed.data.orderId,
  );
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const fulfillment = order.fulfillment;
  if (
    order.status !== "Shipped" ||
    !fulfillment?.trackingNumber ||
    fulfillment.cancelled
  ) {
    if (fulfillment?.cancelled && order.status === "Shipped") {
      return NextResponse.json({ order });
    }
    return NextResponse.json(
      { error: "shipment_not_cancellable" },
      { status: 409 },
    );
  }

  try {
    await cancelShiprocketShipment({
      credentials: {
        email: env.SHIPROCKET_API_EMAIL,
        password: env.SHIPROCKET_API_PASSWORD,
        pickupLocation: env.SHIPROCKET_PICKUP_LOCATION,
      },
      awb: fulfillment.trackingNumber,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "shiprocket_cancellation_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const cancelledFulfillment = { ...fulfillment, cancelled: true };
  const updated = await store.updateCustomerOrderStatus({
    tenantId: session.scope.id,
    orderId: order.id,
    status: "Shipped",
    fulfillment: cancelledFulfillment,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "carrier_order_update_failed" },
      { status: 409 },
    );
  }
  try {
    const adapter = await createTenantOrderAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    await adapter.updateOrderStatus(
      order.id,
      "Shipped",
      cancelledFulfillment,
    );
  } catch {
    return NextResponse.json(
      { error: "tenant_order_sync_failed" },
      { status: 502 },
    );
  }
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: session.scope,
    action: "tenant.order.shiprocket_shipment_cancelled",
    resourceType: "customer_order",
    resourceId: order.id,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ order: updated });
}
