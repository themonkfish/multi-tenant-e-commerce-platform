import { NextResponse } from "next/server";
import { z } from "zod";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";
import { getServerEnv } from "@/lib/server/env";
import { cancelBlueDartShipment } from "@/lib/server/bluedart-shipments";

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
  const parsed = z
    .object({ orderId: z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/) })
    .strict()
    .safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const env = getServerEnv();
  if (
    !env.BLUEDART_API_BASE_URL ||
    !env.BLUEDART_CUSTOMER_CODE ||
    !env.BLUEDART_LOGIN_ID ||
    !env.BLUEDART_LICENSE_KEY
  ) {
    return NextResponse.json(
      { error: "bluedart_credentials_required" },
      { status: 409 },
    );
  }
  const store = getPlatformStore();
  if (
    !(await store.consumeRateLimit({
      key: createRateLimitKey(
        request,
        "tenant-bluedart-cancellation",
        session.userId,
      ),
      limit: 10,
      windowMs: 15 * 60 * 1000,
      now: Date.now(),
    }))
  ) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const order = (await store.listTenantOrders(session.scope.id)).find(
    (candidate) => candidate.id === parsed.data.orderId,
  );
  if (!order?.fulfillment?.trackingNumber || order.status !== "Shipped") {
    return NextResponse.json(
      { error: "shipment_not_cancellable" },
      { status: 409 },
    );
  }
  if (order.fulfillment.cancelled) {
    return NextResponse.json({ order });
  }
  try {
    await cancelBlueDartShipment({
      credentials: {
        baseUrl: env.BLUEDART_API_BASE_URL,
        customerCode: env.BLUEDART_CUSTOMER_CODE,
        loginId: env.BLUEDART_LOGIN_ID,
        licenseKey: env.BLUEDART_LICENSE_KEY,
      },
      awb: order.fulfillment.trackingNumber,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "bluedart_cancellation_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const cancelledFulfillment = { ...order.fulfillment, cancelled: true };
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
  return NextResponse.json({ order: updated });
}
