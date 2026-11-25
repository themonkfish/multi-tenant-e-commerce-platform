import { NextResponse } from "next/server";
import { z } from "zod";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { canAccessPermission } from "@/core/tenancy/scope";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";
import {
  getStripeConfiguration,
  retrieveStripeCheckoutSession,
  StripePaymentConfigurationError,
} from "@/lib/server/stripe-payments";

export const runtime = "nodejs";

const ReconcileSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(255),
  })
  .strict();

type ReconcileRouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  request: Request,
  { params }: ReconcileRouteProps,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ReconcileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_reconciliation_request" },
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
  if (!order || order.paymentMethod !== "stripe") {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (order.paymentSessionId !== parsed.data.sessionId) {
    return NextResponse.json(
      { error: "stale_payment_session" },
      { status: 409 },
    );
  }

  let checkout;
  try {
    checkout = await retrieveStripeCheckoutSession(parsed.data.sessionId);
  } catch (error) {
    if (error instanceof StripePaymentConfigurationError) {
      return NextResponse.json(
        { error: "payment_not_configured" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "payment_provider_unavailable" },
      { status: 502 },
    );
  }

  if (
    checkout.mode !== "payment" ||
    checkout.client_reference_id !== order.id ||
    checkout.currency !== order.currency.toLowerCase() ||
    (checkout.payment_status === "paid" &&
      checkout.amount_total !== order.total)
  ) {
    return NextResponse.json(
      { error: "payment_details_mismatch" },
      { status: 400 },
    );
  }

  const metadata = checkout.metadata;
  if (
    metadata?.tenantId !== order.tenantId ||
    metadata.customerId !== order.customerId ||
    metadata.orderId !== order.id
  ) {
    return NextResponse.json(
      { error: "invalid_order_metadata" },
      { status: 400 },
    );
  }

  if (checkout.status !== "complete" || checkout.payment_status !== "paid") {
    if (checkout.status === "expired") {
      const failed = await store.updateCustomerOrderPayment({
        tenantId: order.tenantId,
        customerId: order.customerId,
        orderId: order.id,
        sessionId: parsed.data.sessionId,
        status: "failed",
      });
      if (!failed) {
        return NextResponse.json(
          { error: "payment_update_conflict" },
          { status: 409 },
        );
      }
      if (order.discountCode) {
        await store.releaseDiscountRedemption(order.tenantId, order.id);
      }
      if (order.items.some((item) => item.inventoryTracked)) {
        const catalog = await createTenantCatalogAdapter(
          order.tenantId,
          session.scope.hostId,
        );
        await catalog.releaseInventory(
          `${order.id}-${order.paymentAttempt}`,
        );
      }
      return NextResponse.json({ order: failed });
    }
    return NextResponse.json(
      { order, reconciliation: "pending" },
      { status: 202 },
    );
  }

  let configuredMode: "test" | "live";
  try {
    configuredMode = getStripeConfiguration().mode;
  } catch (error) {
    if (error instanceof StripePaymentConfigurationError) {
      return NextResponse.json(
        { error: "payment_not_configured" },
        { status: 503 },
      );
    }
    throw error;
  }
  if (metadata.paymentMode !== configuredMode) {
    return NextResponse.json(
      { error: "payment_mode_mismatch" },
      { status: 400 },
    );
  }

  const updated =
    order.paymentStatus === "paid"
      ? order
      : await store.updateCustomerOrderPayment({
          tenantId: order.tenantId,
          customerId: order.customerId,
          orderId: order.id,
          sessionId: parsed.data.sessionId,
          status: "paid",
          ...("payment_intent" in checkout
            ? typeof checkout.payment_intent === "string"
              ? { paymentIntentId: checkout.payment_intent }
              : checkout.payment_intent?.id
                ? { paymentIntentId: checkout.payment_intent.id }
                : {}
            : {}),
        });
  if (!updated) {
    return NextResponse.json(
      { error: "payment_update_conflict" },
      { status: 409 },
    );
  }

  if (order.paymentStatus !== "paid") {
    if (order.items.some((item) => item.inventoryTracked)) {
      const catalog = await createTenantCatalogAdapter(
        order.tenantId,
        session.scope.hostId,
      );
      await catalog.commitInventory(`${order.id}-${order.paymentAttempt}`);
    }
    if (order.discountCode) {
      await store.commitDiscountRedemption(order.tenantId, order.id);
    }
  }

  if (updated.backendSyncStatus === "synced") {
    return NextResponse.json({ order: updated });
  }
  const synced = await syncCustomerOrderToTenant({
    store,
    tenantId: order.tenantId,
    hostId: session.scope.hostId,
    order: updated,
  });
  if (synced.backendSyncStatus !== "synced") {
    return NextResponse.json(
      { error: "order_sync_failed", paymentStatus: "paid", order: synced },
      { status: 503 },
    );
  }
  return NextResponse.json({ order: synced });
}
