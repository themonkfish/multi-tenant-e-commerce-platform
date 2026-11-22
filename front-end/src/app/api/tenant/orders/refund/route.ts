import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createStripeRefund } from "@/lib/server/stripe-payments";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";

const RefundOrderSchema = z
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
  const parsed = RefundOrderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-order-refund", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const tenantOrders = await store.listTenantOrders(session.scope.id);
  const platformOrder = tenantOrders.find(
    (order) => order.id === parsed.data.orderId,
  );
  if (!platformOrder) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (
    platformOrder.paymentMethod !== "stripe" ||
    platformOrder.paymentStatus !== "paid" ||
    !platformOrder.paymentIntentId
  ) {
    return NextResponse.json(
      { error: "order_not_refundable" },
      { status: 409 },
    );
  }

  try {
    const refund = await createStripeRefund({
      order: platformOrder,
      paymentIntentId: platformOrder.paymentIntentId,
    });
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "tenant.order.refund_requested",
      resourceType: "customer_order",
      resourceId: platformOrder.id,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({
      refund: { id: refund.id, status: refund.status },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Stripe payment keys are not configured") {
        return NextResponse.json(
          { error: "payment_not_configured" },
          { status: 503 },
        );
      }
    }
    console.error("Tenant refund request failed", error);
    return NextResponse.json({ error: "refund_failed" }, { status: 502 });
  }
}
