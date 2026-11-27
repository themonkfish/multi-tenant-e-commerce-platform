import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import {
  createRazorpayEventId,
  verifyRazorpayWebhookSignature,
  RazorpayPaymentConfigurationError,
} from "@/lib/server/razorpay-payments";
import {
  createStructuredLogger,
  getRequestCorrelationId,
  recordObservabilityMetric,
} from "@/lib/server/observability";

export const runtime = "nodejs";

const RazorpayWebhookSchema = z.object({
  event: z.enum([
    "payment.captured",
    "payment.failed",
    "order.paid",
    "refund.processed",
  ]),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({
          id: z.string().min(1),
          order_id: z.string().min(1),
          amount: z.number().int().positive(),
          currency: z.literal("INR"),
          notes: z
            .record(z.string(), z.union([z.string(), z.number()]))
            .optional(),
        }),
      })
      .optional(),
    order: z
      .object({
        entity: z.object({
          id: z.string().min(1),
          amount: z.number().int().positive(),
          currency: z.literal("INR"),
          notes: z
            .record(z.string(), z.union([z.string(), z.number()]))
            .optional(),
        }),
      })
      .optional(),
    refund: z
      .object({
        entity: z.object({
          id: z.string().min(1),
          payment_id: z.string().min(1),
          amount: z.number().int().positive(),
          currency: z.literal("INR"),
          status: z.string().min(1).optional(),
          notes: z
            .record(z.string(), z.union([z.string(), z.number()]))
            .optional(),
        }),
      })
      .optional(),
  }),
});

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  const logger = createStructuredLogger({ requestId });
  recordObservabilityMetric("razorpay.webhook.received");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (Buffer.byteLength(payload, "utf8") > 1_048_576) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const parsed = RazorpayWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_razorpay_event" },
      { status: 400 },
    );
  }
  const preliminaryNotes =
    parsed.data.payload.payment?.entity.notes ??
    parsed.data.payload.order?.entity.notes ??
    parsed.data.payload.refund?.entity.notes;
  const preliminaryTenantId =
    typeof preliminaryNotes?.tenantId === "string"
      ? preliminaryNotes.tenantId
      : "";
  let tenantWebhookSecret: string | undefined;
  if (preliminaryTenantId) {
    const parsedTenant = z.uuid().safeParse(preliminaryTenantId);
    if (parsedTenant.success) {
      const store = getPlatformStore();
      const hosts = await store.listHosts();
      for (const host of hosts) {
        const tenants = await store.listTenantsForHost(host.id);
        if (!tenants.some((tenant) => tenant.id === parsedTenant.data)) continue;
        const settings =
          typeof store.getTenantStoreSettings === "function"
            ? await store.getTenantStoreSettings(
                parsedTenant.data,
                host.id,
                "",
              )
            : null;
        if (!settings) break;
        const config = settings.payments.razorpayConfig;
        if (config) {
          try {
            const secret = await getSecretVault().getSecret(
              config.credentialsRef,
            );
            const parsedSecret = JSON.parse(secret) as {
              webhookSecret?: string;
            };
            tenantWebhookSecret = parsedSecret.webhookSecret;
          } catch {
            tenantWebhookSecret = undefined;
          }
        }
        break;
      }
    }
  }
  try {
    if (
      !verifyRazorpayWebhookSignature(
        payload,
        request.headers.get("x-razorpay-signature"),
        tenantWebhookSecret,
      )
    ) {
      recordObservabilityMetric("razorpay.webhook.invalid_signature");
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof RazorpayPaymentConfigurationError) {
      return NextResponse.json(
        { error: "payment_not_configured" },
        { status: 503 },
      );
    }
    throw error;
  }
  if (parsed.data.event === "refund.processed") {
    const refund = parsed.data.payload.refund?.entity;
    if (!refund) {
      return NextResponse.json({ error: "invalid_refund_metadata" }, { status: 400 });
    }
    const notes = refund.notes;
    let hostId = "";
    let tenantId = typeof notes?.tenantId === "string" ? notes.tenantId : "";
    let customerId =
      typeof notes?.customerId === "string" ? notes.customerId : "";
    let orderId = typeof notes?.orderId === "string" ? notes.orderId : "";
    const hosts = await getPlatformStore().listHosts();
    const tenantRecords = await Promise.all(
      hosts.map((host) => getPlatformStore().listTenantsForHost(host.id)),
    );
    let order = null;
    for (let index = 0; index < hosts.length; index += 1) {
      const host = hosts[index];
      const tenants = tenantRecords[index] ?? [];
      if (tenantId && !tenants.some((tenant) => tenant.id === tenantId)) continue;
      const tenantsToSearch = tenantId
        ? tenants.filter((tenant) => tenant.id === tenantId)
        : tenants;
      for (const tenant of tenantsToSearch) {
        const candidates = await getPlatformStore().listTenantOrders(tenant.id);
        const candidate = candidates.find((item) =>
        orderId
          ? item.id === orderId
          : item.paymentMethod === "razorpay" &&
            item.paymentIntentId === refund.payment_id,
        );
        if (candidate) {
          hostId = host.id;
          tenantId = candidate.tenantId;
          customerId = candidate.customerId;
          orderId = candidate.id;
          order = candidate;
          break;
        }
      }
      if (order) break;
    }
    if (!order) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    if (
      order.paymentMethod !== "razorpay" ||
      order.paymentStatus !== "paid" ||
      order.paymentIntentId !== refund.payment_id
    ) {
      if (
        order.paymentMethod === "razorpay" &&
        order.paymentStatus === "refunded"
      ) {
        recordObservabilityMetric("razorpay.webhook.refund_idempotent");
        return NextResponse.json({ received: true });
      }
      return NextResponse.json(
        { error: "payment_details_mismatch" },
        { status: 400 },
      );
    }
    if (refund.amount !== order.total || refund.currency !== order.currency) {
      recordObservabilityMetric("razorpay.webhook.partial_refund");
      return NextResponse.json({ received: true, partial: true });
    }
    const refunded = await getPlatformStore().updateCustomerOrderPayment({
      tenantId,
      customerId,
      orderId,
      sessionId: order.paymentSessionId!,
      status: "refunded",
    });
    if (!refunded) {
      return NextResponse.json(
        { error: "refund_update_conflict" },
        { status: 409 },
      );
    }
    if (order.items.some((item) => item.inventoryTracked)) {
      const catalog = await createTenantCatalogAdapter(tenantId, hostId);
      await catalog.restoreInventory(`${order.id}-${order.paymentAttempt}`);
    }
    if (order.discountCode) {
      await getPlatformStore().cancelDiscountRedemption(tenantId, order.id);
    }
    const tenantOrders = await createTenantOrderAdapter(tenantId, hostId);
    await tenantOrders.updateOrderStatus(order.id, "Cancelled");
    await getPlatformStore().updateCustomerOrderStatus({
      tenantId,
      orderId: order.id,
      status: "Cancelled",
    });
    await getPlatformStore().appendAuditEvent({
      id: randomUUID(),
      actorId: "razorpay-webhook",
      scope: { kind: "tenant", id: tenantId, hostId },
      action: "tenant.order.refunded",
      resourceType: "customer_order",
      resourceId: order.id,
      createdAt: new Date().toISOString(),
    });
    recordObservabilityMetric("razorpay.webhook.refunded");
    return NextResponse.json({
      received: true,
      eventId: createRazorpayEventId(parsed.data),
    });
  }
  const entity =
    parsed.data.payload.payment?.entity ??
    parsed.data.payload.order?.entity;
  if (!entity) {
    return NextResponse.json({ received: true });
  }
  const notes =
    parsed.data.payload.payment?.entity.notes ??
    parsed.data.payload.order?.entity.notes;
  const tenantId = typeof notes?.tenantId === "string" ? notes.tenantId : "";
  const customerId =
    typeof notes?.customerId === "string" ? notes.customerId : "";
  const orderId = typeof notes?.orderId === "string" ? notes.orderId : "";
  if (!tenantId || !customerId || !orderId) {
    return NextResponse.json({ error: "invalid_order_metadata" }, { status: 400 });
  }
  const parsedTenant = z.uuid().safeParse(tenantId);
  const parsedCustomer = z.uuid().safeParse(customerId);
  if (!parsedTenant.success || !parsedCustomer.success) {
    return NextResponse.json({ error: "invalid_order_metadata" }, { status: 400 });
  }
  const store = getPlatformStore();
  const order = await store.getCustomerOrder(
    parsedTenant.data,
    parsedCustomer.data,
    orderId,
  );
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const razorpayOrderId =
    parsed.data.payload.payment?.entity.order_id ??
    parsed.data.payload.order?.entity.id;
  if (!razorpayOrderId || order.paymentSessionId !== razorpayOrderId) {
    return NextResponse.json(
      { error: "stale_payment_session" },
      { status: 409 },
    );
  }
  let paidOrder: typeof order | null = null;
  if (
    parsed.data.event === "payment.captured" ||
    parsed.data.event === "order.paid"
  ) {
    if (entity.amount !== order.total || entity.currency !== order.currency) {
      return NextResponse.json(
        { error: "payment_details_mismatch" },
        { status: 400 },
      );
    }
    paidOrder = await store.updateCustomerOrderPayment({
      tenantId: parsedTenant.data,
      customerId: parsedCustomer.data,
      orderId,
      sessionId: razorpayOrderId,
      status: "paid",
      ...(parsed.data.payload.payment?.entity.id
        ? { paymentIntentId: parsed.data.payload.payment.entity.id }
        : {}),
    });
    if (!paidOrder) {
      return NextResponse.json(
        { error: "payment_update_conflict" },
        { status: 409 },
      );
    }
    recordObservabilityMetric("razorpay.webhook.captured");
  } else {
    const updated = await store.updateCustomerOrderPayment({
      tenantId: parsedTenant.data,
      customerId: parsedCustomer.data,
      orderId,
      sessionId: razorpayOrderId,
      status: "failed",
    });
    if (!updated) {
      return NextResponse.json(
        { error: "payment_update_conflict" },
        { status: 409 },
      );
    }
    if (order.items.some((item) => item.inventoryTracked)) {
      const hosts = await store.listHosts();
      const tenantRecords = await Promise.all(
        hosts.map((host) => store.listTenantsForHost(host.id)),
      );
      const hostId =
        tenantRecords.flat().find((tenant) => tenant.id === parsedTenant.data)
          ?.hostId;
      if (hostId) {
        const catalog = await createTenantCatalogAdapter(
          parsedTenant.data,
          hostId,
        );
        await catalog.releaseInventory(
          `${order.id}-${order.paymentAttempt}`,
        );
      }
    }
    if (order.discountCode) {
      await store.releaseDiscountRedemption(parsedTenant.data, order.id);
    }
  }
  const hosts = await store.listHosts();
  const tenantRecords = await Promise.all(
    hosts.map((host) => store.listTenantsForHost(host.id)),
  );
  const hostId =
    tenantRecords.flat().find((tenant) => tenant.id === parsedTenant.data)
      ?.hostId ?? "";
  if (!hostId) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  if (paidOrder) {
    if (paidOrder.items.some((item) => item.inventoryTracked)) {
      const catalog = await createTenantCatalogAdapter(
        parsedTenant.data,
        hostId,
      );
      await catalog.commitInventory(
        `${paidOrder.id}-${paidOrder.paymentAttempt}`,
      );
    }
    if (paidOrder.discountCode) {
      await store.commitDiscountRedemption(
        parsedTenant.data,
        paidOrder.id,
      );
    }
    if (paidOrder.backendSyncStatus !== "synced") {
      try {
        await syncCustomerOrderToTenant({
          store,
          tenantId: parsedTenant.data,
          hostId,
          order: paidOrder,
        });
      } catch {
        recordObservabilityMetric("razorpay.order_sync.failed");
        logger.error(
          "razorpay.order_sync_failed",
          new Error("Tenant sync unavailable"),
          { tenantId: parsedTenant.data, orderId: paidOrder.id },
        );
        return NextResponse.json(
          { error: "order_sync_failed", paymentStatus: "paid" },
          { status: 503 },
        );
      }
    }
  }
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: "razorpay-webhook",
    scope: { kind: "tenant", id: parsedTenant.data, hostId },
    action: "tenant.order.payment_razorpay",
    resourceType: "customer_order",
    resourceId: orderId,
    createdAt: new Date().toISOString(),
  });
  logger.info("razorpay.webhook.processed", {
    orderId,
    event: parsed.data.event,
  });
  return NextResponse.json({
    received: true,
    eventId: createRazorpayEventId(parsed.data),
  });
}
