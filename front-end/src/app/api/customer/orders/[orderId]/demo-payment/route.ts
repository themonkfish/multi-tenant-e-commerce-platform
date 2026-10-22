import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccessPermission } from "@/core/tenancy/scope";
import {
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
} from "@/lib/server/demo-checkout";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";

const DemoPaymentSchema = z
  .object({ result: z.enum(["paid", "failed"]) })
  .strict();

type DemoPaymentRouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  request: Request,
  { params }: DemoPaymentRouteProps,
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (!isLocalDemoCheckoutEnabled(request.headers.get("host"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = DemoPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payment_result" },
      { status: 400 },
    );
  }

  const { orderId } = await params;
  const store = getPlatformStore();
  const order = await store.getCustomerOrder(
    session.scope.id,
    session.userId,
    orderId,
  );
  if (
    !order ||
    !order.paymentSessionId ||
    !isDemoCheckoutSession(order.paymentSessionId)
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (order.paymentStatus !== "pending") {
    return NextResponse.json({ error: "payment_not_pending" }, { status: 409 });
  }

  const updated = await store.updateCustomerOrderPayment({
    tenantId: order.tenantId,
    customerId: order.customerId,
    orderId: order.id,
    sessionId: order.paymentSessionId,
    status: parsed.data.result,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "payment_update_conflict" },
      { status: 409 },
    );
  }
  if (updated.paymentStatus !== "paid") {
    return NextResponse.json({ order: updated });
  }

  const deliveredOrder = await syncCustomerOrderToTenant({
    store,
    tenantId: order.tenantId,
    hostId: session.scope.hostId,
    order: updated,
  });
  return NextResponse.json({ order: deliveredOrder });
}
