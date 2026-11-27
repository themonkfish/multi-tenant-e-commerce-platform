import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CarrierEventStatus } from "./carrier-webhooks";

function normalizeStatusLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const BLUEDART_STATUS_MAP: Record<string, CarrierEventStatus> = {
  booked: "label_created",
  manifested: "label_created",
  "label created": "label_created",
  "picked up": "picked_up",
  pickup: "picked_up",
  shipped: "in_transit",
  "in transit": "in_transit",
  "in-transit": "in_transit",
  "out for delivery": "out_for_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
  returned: "returned",
  rto: "returned",
};

export function normalizeBlueDartStatus(input: {
  status?: string;
  shipmentStatus?: string;
  currentStatus?: string;
  scanStatus?: string;
}): CarrierEventStatus | null {
  for (const value of [
    input.status,
    input.shipmentStatus,
    input.currentStatus,
    input.scanStatus,
  ]) {
    if (!value) continue;
    const mapped = BLUEDART_STATUS_MAP[normalizeStatusLabel(value)];
    if (mapped) return mapped;
  }
  return null;
}

export function verifyBlueDartWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const normalized = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  if (!/^[A-Fa-f0-9]{64}$/.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(normalized, "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function createBlueDartEventId(input: {
  awb: string;
  orderId: string;
  status?: string;
  timestamp?: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.awb,
        input.orderId,
        input.status ?? "",
        input.timestamp ?? "",
      ].join("\0"),
    )
    .digest("hex");
  return `bluedart-${digest}`;
}
