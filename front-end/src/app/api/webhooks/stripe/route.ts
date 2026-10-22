import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { getPlatformStore } from "@/lib/server/platform";
import {
  StripePaymentConfigurationError,
  verifyStripeWebhookEvent,
} from "@/lib/server/stripe-payments";

export const runtime = "nodejs";

const OrderMetadataSchema = z.object({
  tenantId: z.uuid(),
  customerId: z.uuid(),
  orderId: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let event: Stripe.Event;
  try {
    const payload = await request.text();
    if (Buffer.byteLength(payload, "utf8") > 1_048_576) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    event = verifyStripeWebhookEvent(payload, signature);
  } catch (error) {
    if (error instanceof StripePaymentConfigurationError) {
      return NextResponse.json(
        { error: "payment_not_configured" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const isPaid =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded";
  const isFailed =
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed";
  if (!isPaid && !isFailed) {
    return NextResponse.json({ received: true });
  }

  const checkout = event.data.object as Stripe.Checkout.Session;
  const metadata = OrderMetadataSchema.safeParse(checkout.metadata);
  if (!metadata.success) {
    return NextResponse.json(
      { error: "invalid_order_metadata" },
      { status: 400 },
    );
  }
  if (isPaid && checkout.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const store = getPlatformStore();
  const { tenantId, customerId, orderId } = metadata.data;
  const order = await store.getCustomerOrder(tenantId, customerId, orderId);
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (
    checkout.mode !== "payment" ||
    checkout.client_reference_id !== order.id ||
    (isPaid && checkout.amount_total !== order.total) ||
    checkout.currency !== order.currency.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "payment_details_mismatch" },
      { status: 400 },
    );
  }
  if (order.paymentSessionId !== checkout.id) {
    return NextResponse.json(
      { error: "stale_payment_session" },
      { status: 409 },
    );
  }
  if (isFailed && order.paymentStatus === "paid") {
    return NextResponse.json({ received: true });
  }

  const paymentIntentId =
    "payment_intent" in checkout
      ? typeof checkout.payment_intent === "string"
        ? checkout.payment_intent
        : (checkout.payment_intent?.id ?? undefined)
      : undefined;
  const updated = await store.updateCustomerOrderPayment({
    tenantId,
    customerId,
    orderId,
    sessionId: checkout.id,
    status: isPaid ? "paid" : "failed",
    ...(paymentIntentId ? { paymentIntentId } : {}),
  });
  if (!updated) {
    return NextResponse.json(
      { error: "payment_update_conflict" },
      { status: 409 },
    );
  }
  if (updated.paymentStatus !== "paid") {
    return NextResponse.json({ received: true });
  }
  if (updated.backendSyncStatus === "synced") {
    return NextResponse.json({ received: true });
  }

  const syncedOrder = await syncCustomerOrderToTenant({
    store,
    tenantId,
    hostId: await getActiveTenantHostId(store, tenantId),
    order: updated,
  });
  if (syncedOrder.backendSyncStatus !== "synced") {
    return NextResponse.json(
      { error: "order_sync_failed", paymentStatus: "paid" },
      { status: 503 },
    );
  }
  return NextResponse.json({ received: true });
}

async function getActiveTenantHostId(
  store: ReturnType<typeof getPlatformStore>,
  tenantId: string,
): Promise<string> {
  const hosts = await store.listHosts();
  const tenants = await Promise.all(
    hosts.map((host) => store.listTenantsForHost(host.id)),
  );
  const tenant = tenants.flat().find((record) => record.id === tenantId);
  if (!tenant) throw new Error("Cannot locate the paid order's tenant");
  return tenant.hostId;
}
