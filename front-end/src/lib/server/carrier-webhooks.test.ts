import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeCarrierEventStatus,
  verifyCarrierWebhookSignature,
} from "./carrier-webhooks";

describe("carrier webhook helpers", () => {
  it("verifies HMAC signatures and rejects tampering", () => {
    const payload = '{"eventId":"evt-1"}';
    const secret = "carrier-test-secret-at-least-16";
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(
      verifyCarrierWebhookSignature(payload, `sha256=${signature}`, secret),
    ).toBe(true);
    expect(
      verifyCarrierWebhookSignature(`${payload} `, signature, secret),
    ).toBe(false);
  });

  it("normalizes carrier events to operational order statuses", () => {
    expect(normalizeCarrierEventStatus("picked_up")).toBe("Processing");
    expect(normalizeCarrierEventStatus("in_transit")).toBe("Shipped");
    expect(normalizeCarrierEventStatus("out_for_delivery")).toBe("Shipped");
    expect(normalizeCarrierEventStatus("delivered")).toBe("Delivered");
    expect(normalizeCarrierEventStatus("cancelled")).toBeNull();
  });
});
