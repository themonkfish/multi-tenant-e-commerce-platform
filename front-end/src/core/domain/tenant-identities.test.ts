import { describe, expect, it } from "vitest";
import { OrderFulfillmentSchema } from "./tenant-identities";

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
});
