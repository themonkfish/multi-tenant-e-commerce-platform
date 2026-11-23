import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import {
  buildCarrierTrackingUrl,
  type OrderFulfillment,
} from "@/core/domain/tenant-identities";
import { getPlatformStore } from "@/lib/server/platform";
import {
  carrierStatusRank,
  normalizeCarrierEventStatus,
  type CarrierEventStatus,
} from "@/lib/server/carrier-webhooks";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import {
  createStructuredLogger,
  recordObservabilityMetric,
} from "@/lib/server/observability";

export type CarrierEventInput = {
  eventId: string;
  tenantId: string;
  orderId: string;
  trackingNumber: string;
  status: CarrierEventStatus;
  carrier?: string;
  fulfillment?: Pick<OrderFulfillment, "trackingUrl">;
};

export async function applyCarrierEvent(
  event: CarrierEventInput,
  requestId: string,
) {
  const logger = createStructuredLogger({
    requestId,
    tenantId: event.tenantId,
  });
  const normalizedStatus = normalizeCarrierEventStatus(event.status);
  if (!normalizedStatus) {
    return NextResponse.json({ received: true });
  }

  const store = getPlatformStore();
  const tenantOrders = await store.listTenantOrders(event.tenantId);
  const platformOrder = tenantOrders.find(
    (order) => order.id === event.orderId,
  );
  if (!platformOrder) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (
    platformOrder.fulfillment?.trackingNumber &&
    platformOrder.fulfillment.trackingNumber !== event.trackingNumber
  ) {
    return NextResponse.json(
      { error: "tracking_number_mismatch" },
      { status: 409 },
    );
  }

  const fulfillment = {
    carrier: event.carrier ?? platformOrder.fulfillment?.carrier,
    trackingNumber: event.trackingNumber,
    trackingUrl:
      event.fulfillment?.trackingUrl ??
      platformOrder.fulfillment?.trackingUrl ??
      buildCarrierTrackingUrl(
        event.carrier ?? platformOrder.fulfillment?.carrier,
        event.trackingNumber,
      ),
  };
  if (!fulfillment.trackingNumber) {
    return NextResponse.json(
      { error: "invalid_carrier_event" },
      { status: 400 },
    );
  }

  if (
    platformOrder.status === normalizedStatus &&
    platformOrder.fulfillment?.carrier === fulfillment.carrier &&
    platformOrder.fulfillment?.trackingNumber === fulfillment.trackingNumber &&
    platformOrder.fulfillment?.trackingUrl === fulfillment.trackingUrl
  ) {
    recordObservabilityMetric("carrier.webhook.idempotent");
    return NextResponse.json({ received: true, eventId: event.eventId });
  }

  if (
    carrierStatusRank(normalizedStatus) <
    carrierStatusRank(platformOrder.status)
  ) {
    return NextResponse.json({ received: true });
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

  const hosts = await store.listHosts();
  const tenantRecords = await Promise.all(
    hosts.map((host) => store.listTenantsForHost(host.id)),
  );
  const hostId =
    tenantRecords.flat().find((tenant) => tenant.id === event.tenantId)
      ?.hostId ?? "";
  if (!hostId) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  try {
    const adapter = await createTenantOrderAdapter(event.tenantId, hostId);
    if (normalizedStatus === "Shipped") {
      if (platformOrder.status === "Confirmed") {
        await adapter.updateOrderStatus(
          event.orderId,
          "Processing",
          fulfillment,
        );
      }
      await adapter.updateOrderStatus(
        event.orderId,
        normalizedStatus,
        fulfillment,
      );
    } else if (normalizedStatus === "Processing") {
      await adapter.updateOrderStatus(
        event.orderId,
        normalizedStatus,
        fulfillment,
      );
    } else {
      await adapter.updateOrderStatus(event.orderId, normalizedStatus);
    }
  } catch (error) {
    recordObservabilityMetric("carrier.webhook.sync_failed");
    logger.error("carrier.webhook.sync_failed", error, {
      orderId: event.orderId,
    });
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
    tenantId: event.tenantId,
    orderId: event.orderId,
    status: normalizedStatus,
    ...(normalizedStatus !== "Delivered" ? { fulfillment } : {}),
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
    scope: { kind: "tenant", id: event.tenantId, hostId },
    action: "tenant.order.carrier_event",
    resourceType: "customer_order",
    resourceId: event.orderId,
    createdAt: new Date().toISOString(),
  });
  recordObservabilityMetric("carrier.webhook.processed");
  logger.info("carrier.webhook.processed", {
    orderId: event.orderId,
    status: normalizedStatus,
  });
  return NextResponse.json({ received: true, eventId: event.eventId });
}
