import { describe, expect, it } from "vitest";
import {
  buildCarrierTrackingUrl,
  OrderFulfillmentSchema,
} from "./tenant-identities";

describe("OrderFulfillmentSchema", () => {
  it("accepts a tracking number and optional HTTPS tracking details", () => {
    expect(
      OrderFulfillmentSchema.parse({
        carrier: "Parcel service",
        trackingNumber: "TRACK-123",
        trackingUrl: "https://tracking.example.com/TRACK-123",
      }),
    ).toEqual({
      carrier: "Parcel service",
      trackingNumber: "TRACK-123",
      trackingUrl: "https://tracking.example.com/TRACK-123",
    });
    expect(
      OrderFulfillmentSchema.parse({ trackingNumber: "TRACK-123" }),
    ).toEqual({ trackingNumber: "TRACK-123" });
  });

  it("rejects insecure URLs, empty tracking numbers, and unknown fields", () => {
    expect(
      OrderFulfillmentSchema.safeParse({
        trackingNumber: "TRACK-123",
        trackingUrl: "http://tracking.example.com/TRACK-123",
      }).success,
    ).toBe(false);
    expect(
      OrderFulfillmentSchema.safeParse({ trackingNumber: " " }).success,
    ).toBe(false);
    expect(
      OrderFulfillmentSchema.safeParse({
        trackingNumber: "TRACK-123",
        secret: "unexpected",
      }).success,
    ).toBe(false);
  });

  it("builds HTTPS tracking links for supported carriers", () => {
    expect(buildCarrierTrackingUrl("FedEx", "TRACK 123")).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=TRACK%20123",
    );
    expect(buildCarrierTrackingUrl("Delhivery", "DLV123")).toBe(
      "https://www.delhivery.com/track/package/DLV123",
    );
    expect(
      buildCarrierTrackingUrl("Custom carrier", "TRACK123"),
    ).toBeUndefined();
  });
});
