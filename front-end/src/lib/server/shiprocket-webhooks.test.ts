import { describe, expect, it } from "vitest";
import {
  createShiprocketEventId,
  normalizeShiprocketStatus,
} from "./shiprocket-webhooks";

describe("Shiprocket webhook helpers", () => {
  it.each([
    ["MANIFEST GENERATED", "label_created"],
    ["PICKED UP", "picked_up"],
    ["IN TRANSIT", "in_transit"],
    ["OUT FOR DELIVERY", "out_for_delivery"],
    ["DELIVERED", "delivered"],
    ["RTO DELIVERED", "returned"],
  ] as const)("normalizes %s tracking status", (status, expected) => {
    expect(normalizeShiprocketStatus({ currentStatus: status })).toBe(expected);
  });

  it("uses the shipment status when current status is not recognized", () => {
    expect(
      normalizeShiprocketStatus({
        currentStatus: "unmapped provider status",
        shipmentStatus: "IN TRANSIT",
      }),
    ).toBe("in_transit");
  });

  it("ignores unknown provider statuses", () => {
    expect(
      normalizeShiprocketStatus({ currentStatus: "shipment exception" }),
    ).toBeNull();
  });

  it("creates stable event identifiers from provider tracking fields", () => {
    const event = {
      awb: "19041424751540",
      orderId: "ORD-550e8400-e29b-41d4-a716-446655440001",
      currentStatus: "IN TRANSIT",
      currentTimestamp: "23 05 2023 11:43:52",
    };
    expect(createShiprocketEventId(event)).toBe(createShiprocketEventId(event));
    expect(createShiprocketEventId(event)).not.toBe(
      createShiprocketEventId({ ...event, currentStatus: "DELIVERED" }),
    );
  });
});
