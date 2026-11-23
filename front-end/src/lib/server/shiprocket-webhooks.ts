import { createHash } from "node:crypto";
import type { CarrierEventStatus } from "./carrier-webhooks";

function normalizeStatusLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const SHIPROCKET_STATUS_MAP: Record<string, CarrierEventStatus> = {
  "manifest generated": "label_created",
  "manifest uploaded": "label_created",
  manifested: "label_created",
  "label created": "label_created",
  "pickup scheduled": "label_created",
  "picked up": "picked_up",
  "pickup complete": "picked_up",
  shipped: "in_transit",
  "in transit": "in_transit",
  "out for delivery": "out_for_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
  returned: "returned",
  "return to origin": "returned",
  rto: "returned",
  "rto delivered": "returned",
};

export function normalizeShiprocketStatus(input: {
  currentStatus?: string;
  shipmentStatus?: string;
}): CarrierEventStatus | null {
  for (const value of [input.currentStatus, input.shipmentStatus]) {
    if (!value) continue;
    const mapped = SHIPROCKET_STATUS_MAP[normalizeStatusLabel(value)];
    if (mapped) return mapped;
  }
  return null;
}

export function createShiprocketEventId(input: {
  awb: string;
  orderId: string;
  currentStatus?: string;
  shipmentStatus?: string;
  currentTimestamp?: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.awb,
        input.orderId,
        input.currentStatus ?? "",
        input.shipmentStatus ?? "",
        input.currentTimestamp ?? "",
      ].join("\0"),
    )
    .digest("hex");
  return `shiprocket-${digest}`;
}
