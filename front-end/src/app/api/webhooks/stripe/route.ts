import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { getPlatformStore } from "@/lib/server/platform";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import {
  StripePaymentConfigurationError,
  verifyStripeWebhookEvent,
} from "@/lib/server/stripe-payments";
import {
  createStructuredLogger,
  getRequestCorrelationId,
  recordObservabilityMetric,
} from "@/lib/server/observability";

export const runtime = "nodejs";

const OrderMetadataSchema = z.object({
  tenantId: z.uuid(),
  customerId: z.uuid(),
  orderId: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  const logger = createStructuredLogger({ requestId });
  recordObservabilityMetric("stripe.webhook.received");
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

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (
      !charge.refunded ||
      !Number.isSafeInteger(charge.amount) ||
      !Number.isSafeInteger(charge.amount_refunded) ||
      charge.amount_refunded < charge.amount
    ) {
      return NextResponse.json({ received: true });
    }
    const metadata = OrderMetadataSchema.safeParse(charge.metadata);
    if (!metadata.success) {
      return NextResponse.json(
        { error: "invalid_order_metadata" },
        { status: 400 },
      );
    }
    const { tenantId, customerId, orderId } = metadata.data;
    const order = await getPlatformStore().getCustomerOrder(
      tenantId,
      customerId,
      orderId,
    );
    if (!order) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    if (order.paymentStatus !== "paid" && order.paymentStatus !== "refunded") {
      return NextResponse.json({ received: true });
    }
    if (!order.paymentSessionId) {
      return NextResponse.json({ received: true });
    }
    const refunded = await getPlatformStore().updateCustomerOrderPayment({
      tenantId,
      customerId,
      orderId,
      sessionId: order.paymentSessionId,
      status: "refunded",
    });
    if (!refunded) {
      return NextResponse.json(
        { error: "refund_update_conflict" },
        { status: 409 },
      );
    }
    if (order.paymentStatus !== "refunded") {
      if (order.items.some((item) => item.inventoryTracked)) {
        const hostId = await getActiveTenantHostId(
          getPlatformStore(),
          tenantId,
        );
        const catalog = await createTenantCatalogAdapter(tenantId, hostId);
        await catalog.restoreInventory(`${order.id}-${order.paymentAttempt}`);
      }
      if (order.discountCode) {
        await getPlatformStore().cancelDiscountRedemption(tenantId, order.id);
      }
      const hostId = await getActiveTenantHostId(getPlatformStore(), tenantId);
      const tenantOrders = await createTenantOrderAdapter(tenantId, hostId);
      await tenantOrders.updateOrderStatus(order.id, "Cancelled");
      await getPlatformStore().updateCustomerOrderStatus({
        tenantId,
        orderId: order.id,
        status: "Cancelled",
      });
      await getPlatformStore().appendAuditEvent({
        id: randomUUID(),
        actorId: "stripe-webhook",
        scope: { kind: "tenant", id: tenantId, hostId },
        action: "tenant.order.refunded",
        resourceType: "customer_order",
        resourceId: order.id,
        createdAt: new Date().toISOString(),
      });
    }
    recordObservabilityMetric("stripe.webhook.refunded");
    return NextResponse.json({ received: true });
  }

  const isPaid =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded";
  const isFailed =
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed";
  if (!isPaid && !isFailed) {
    recordObservabilityMetric("stripe.webhook.ignored");
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
    recordObservabilityMetric("stripe.webhook.failed_after_paid");
    return NextResponse.json({ received: true });
  }
  if (isFailed && order.paymentStatus === "failed") {
    if (order.discountCode) {
      await store.releaseDiscountRedemption(order.tenantId, order.id);
    }
    if (order.items.some((item) => item.inventoryTracked)) {
      const hostId = await getActiveTenantHostId(store, tenantId);
      const catalog = await createTenantCatalogAdapter(tenantId, hostId);
      await catalog.releaseInventory(`${order.id}-${order.paymentAttempt}`);
    }
    return NextResponse.json({ received: true });
  }

  const paymentIntentId =
    "payment_intent" in checkout
      ? typeof checkout.payment_intent === "string"
        ? checkout.payment_intent
        : (checkout.payment_intent?.id ?? undefined)
      : undefined;
  const updated =
    isPaid && order.paymentStatus === "paid"
      ? order
      : await store.updateCustomerOrderPayment({
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
  const hostId = await getActiveTenantHostId(store, tenantId);
  if (order.items.some((item) => item.inventoryTracked)) {
    const catalog = await createTenantCatalogAdapter(tenantId, hostId);
    if (updated.paymentStatus !== "paid") {
      await catalog.releaseInventory(`${order.id}-${order.paymentAttempt}`);
      if (order.discountCode) {
        await store.releaseDiscountRedemption(order.tenantId, order.id);
      }
      return NextResponse.json({ received: true });
    }
    if (order.paymentStatus !== "paid") {
      await catalog.commitInventory(`${order.id}-${order.paymentAttempt}`);
    }
  }
  if (updated.paymentStatus !== "paid") {
    if (order.discountCode) {
      await store.releaseDiscountRedemption(order.tenantId, order.id);
    }
    return NextResponse.json({ received: true });
  }
  if (order.discountCode && order.paymentStatus !== "paid") {
    await store.commitDiscountRedemption(order.tenantId, order.id);
  }
  if (updated.backendSyncStatus === "synced") {
    recordObservabilityMetric("stripe.webhook.paid");
    recordObservabilityMetric("stripe.order_sync.synced");
    return NextResponse.json({ received: true });
  }

  let syncedOrder;
  try {
    syncedOrder = await syncCustomerOrderToTenant({
      store,
      tenantId,
      hostId,
      order: updated,
    });
  } catch {
    recordObservabilityMetric("stripe.order_sync.failed");
    logger.error(
      "stripe.order_sync_failed",
      new Error("Tenant sync unavailable"),
      {
        tenantId,
        orderId,
      },
    );
    return NextResponse.json(
      { error: "order_sync_failed", paymentStatus: "paid" },
      { status: 503 },
    );
  }
  if (syncedOrder.backendSyncStatus !== "synced") {
    recordObservabilityMetric("stripe.order_sync.failed");
    return NextResponse.json(
      { error: "order_sync_failed", paymentStatus: "paid" },
      { status: 503 },
    );
  }
  recordObservabilityMetric("stripe.webhook.paid");
  recordObservabilityMetric("stripe.order_sync.synced");
  logger.info("stripe.payment_reconciled", {
    tenantId,
    orderId,
  });
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
import { randomUUID } from "node:crypto";
