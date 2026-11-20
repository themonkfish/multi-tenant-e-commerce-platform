import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { OrderFulfillmentSchema } from "@/core/domain/tenant-identities";
import { getServerEnv } from "@/lib/server/env";
import { getPlatformStore } from "@/lib/server/platform";
import {
  normalizeCarrierEventStatus,
  verifyCarrierWebhookSignature,
  type CarrierEventStatus,
} from "@/lib/server/carrier-webhooks";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";

export const runtime = "nodejs";

const CarrierEventSchema = z
  .object({
    eventId: z.string().trim().min(1).max(128),
    tenantId: z.uuid(),
    orderId: z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/),
    trackingNumber: z.string().trim().min(1).max(120),
    status: z.enum([
      "label_created",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "returned",
    ]),
    carrier: z.string().trim().min(1).max(80).optional(),
    fulfillment: OrderFulfillmentSchema.partial().optional(),
  })
  .strict();

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getServerEnv().CARRIER_WEBHOOK_SECRET ?? "";
  } catch {
    return NextResponse.json(
      { error: "carrier_webhook_not_configured" },
      { status: 503 },
    );
  }
  if (!secret) {
    return NextResponse.json(
      { error: "carrier_webhook_not_configured" },
      { status: 503 },
    );
  }

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
  if (
    !verifyCarrierWebhookSignature(
      payload,
      request.headers.get("x-carrier-signature"),
      secret,
    )
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const parsed = CarrierEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_carrier_event" },
      { status: 400 },
    );
  }

  const normalizedStatus = normalizeCarrierEventStatus(
    parsed.data.status as CarrierEventStatus,
  );
  if (!normalizedStatus) {
    return NextResponse.json({ received: true });
  }

  const store = getPlatformStore();
  const tenantOrders = await store.listTenantOrders(parsed.data.tenantId);
  const platformOrder = tenantOrders.find(
    (order) => order.id === parsed.data.orderId,
  );
  if (!platformOrder) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const fulfillment = {
    carrier: parsed.data.carrier ?? platformOrder.fulfillment?.carrier,
    trackingNumber:
      parsed.data.trackingNumber ??
      platformOrder.fulfillment?.trackingNumber ??
      "",
    trackingUrl:
      parsed.data.fulfillment?.trackingUrl ??
      platformOrder.fulfillment?.trackingUrl,
  };
  if (!fulfillment.trackingNumber) {
    return NextResponse.json(
      { error: "invalid_carrier_event" },
      { status: 400 },
    );
  }

  if (
    platformOrder.status === normalizedStatus &&
    platformOrder.fulfillment?.trackingNumber === fulfillment.trackingNumber &&
    platformOrder.fulfillment?.trackingUrl === fulfillment.trackingUrl
  ) {
    return NextResponse.json({ received: true, eventId: parsed.data.eventId });
  }

  const hosts = await store.listHosts();
  const tenantRecords = await Promise.all(
    hosts.map((host) => store.listTenantsForHost(host.id)),
  );
  const hostId =
    tenantRecords.flat().find((tenant) => tenant.id === parsed.data.tenantId)
      ?.hostId ?? "";
  if (!hostId) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  if (
    normalizedStatus === "Delivered" &&
    platformOrder.status !== "Shipped" &&
    platformOrder.status !== "Delivered"
  ) {
    return NextResponse.json(
      { error: "invalid_status_transition" },
      { status: 409 },
    );
  }
  if (
    normalizedStatus === "Processing" &&
    platformOrder.status === "Delivered"
  ) {
    return NextResponse.json({ received: true });
  }

  try {
    const adapter = await createTenantOrderAdapter(
      parsed.data.tenantId,
      hostId,
    );
    await adapter.updateOrderStatus(
      parsed.data.orderId,
      normalizedStatus,
      fulfillment,
    );
  } catch (error) {
    if (error instanceof RestBackendError && error.status === 409) {
      return NextResponse.json(
        { error: "invalid_status_transition" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "carrier_order_sync_failed" },
      { status: 502 },
    );
  }

  const updated = await store.updateCustomerOrderStatus({
    tenantId: parsed.data.tenantId,
    orderId: parsed.data.orderId,
    status: normalizedStatus,
    fulfillment,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "carrier_order_update_failed" },
      { status: 409 },
    );
  }
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: "carrier-webhook",
    scope: { kind: "tenant", id: parsed.data.tenantId, hostId },
    action: "tenant.order.carrier_event",
    resourceType: "customer_order",
    resourceId: parsed.data.orderId,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ received: true, eventId: parsed.data.eventId });
}
