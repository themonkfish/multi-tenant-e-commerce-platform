import "server-only";
import { timingSafeEqual, createHmac } from "node:crypto";

export type CarrierEventStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned";

export type NormalizedCarrierStatus = "Processing" | "Shipped" | "Delivered";

export function verifyCarrierWebhookSignature(
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

export function normalizeCarrierEventStatus(
  status: CarrierEventStatus,
): NormalizedCarrierStatus | null {
  switch (status) {
    case "label_created":
    case "picked_up":
      return "Processing";
    case "in_transit":
    case "out_for_delivery":
      return "Shipped";
    case "delivered":
      return "Delivered";
    default:
      return null;
  }
}

export function carrierStatusRank(
  status: "Confirmed" | "Processing" | "Shipped" | "Delivered" | "Cancelled",
): number {
  switch (status) {
    case "Confirmed":
      return 0;
    case "Processing":
      return 1;
    case "Shipped":
      return 2;
    case "Delivered":
      return 3;
    case "Cancelled":
      return -1;
  }
}
