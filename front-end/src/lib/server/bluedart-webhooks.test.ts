import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBlueDartEventId,
  normalizeBlueDartStatus,
  verifyBlueDartWebhookSignature,
} from "./bluedart-webhooks";

describe("BlueDart webhook helpers", () => {
  it.each([
    ["MANIFESTED", "label_created"],
    ["PICKED UP", "picked_up"],
    ["IN TRANSIT", "in_transit"],
    ["OUT FOR DELIVERY", "out_for_delivery"],
    ["DELIVERED", "delivered"],
    ["RTO", "returned"],
  ] as const)("normalizes %s tracking status", (status, expected) => {
    expect(normalizeBlueDartStatus({ status })).toBe(expected);
  });

  it("falls back through alternate provider status fields", () => {
    expect(
      normalizeBlueDartStatus({
        status: "Shipment Exception",
        scanStatus: "IN TRANSIT",
      }),
    ).toBe("in_transit");
  });

  it("ignores unknown provider statuses", () => {
    expect(
      normalizeBlueDartStatus({ currentStatus: "Shipment Exception" }),
    ).toBeNull();
  });

  it("verifies HMAC-SHA256 signatures", () => {
    const payload = JSON.stringify({ awb: "BD123" });
    const secret = "bluedart-webhook-test-secret";
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    expect(
      verifyBlueDartWebhookSignature(payload, `sha256=${signature}`, secret),
    ).toBe(true);
    expect(
      verifyBlueDartWebhookSignature(payload, "0".repeat(64), secret),
    ).toBe(false);
  });

  it("creates stable replay-safe event identifiers", () => {
    const event = {
      awb: "BD123",
      orderId: "ORD-550e8400-e29b-41d4-a716-446655440001",
      status: "IN TRANSIT",
      timestamp: "2026-11-27T10:00:00Z",
    };
    expect(createBlueDartEventId(event)).toBe(createBlueDartEventId(event));
    expect(createBlueDartEventId(event)).not.toBe(
      createBlueDartEventId({ ...event, status: "DELIVERED" }),
    );
  });
});
