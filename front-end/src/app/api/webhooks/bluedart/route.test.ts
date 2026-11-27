import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { applyCarrierEvent } = vi.hoisted(() => ({
  applyCarrierEvent: vi.fn(),
}));

vi.mock("@/lib/server/carrier-event-handler", () => ({ applyCarrierEvent }));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const token = "bluedart-webhook-test-token";

function request(
  body: unknown,
  options: { tenant?: boolean; signature?: string } = {},
) {
  const payload = JSON.stringify(body);
  const signature =
    options.signature ??
    `sha256=${createHmac("sha256", token).update(payload).digest("hex")}`;
  const tenant =
    options.tenant === false ? "" : `?tenantId=${tenantId}`;
  return new Request(
    `https://store.example.test/api/webhooks/bluedart${tenant}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        "x-bluedart-signature": signature,
      },
      body: payload,
    },
  );
}

describe("POST /api/webhooks/bluedart", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("adapts BlueDart tracking events to the shared carrier handler", async () => {
    vi.stubEnv("BLUEDART_WEBHOOK_TOKEN", token);
    applyCarrierEvent.mockResolvedValue(
      Response.json({ received: true }, { status: 200 }),
    );

    const response = await POST(
      request({
        awbNumber: "BD123",
        referenceNumber: orderId,
        status: "IN TRANSIT",
        timestamp: "2026-11-27T10:00:00Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(applyCarrierEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        orderId,
        trackingNumber: "BD123",
        carrier: "BlueDart",
        status: "in_transit",
      }),
      expect.any(String),
    );
  });

  it("rejects an invalid HMAC signature", async () => {
    vi.stubEnv("BLUEDART_WEBHOOK_TOKEN", token);

    const response = await POST(
      request(
        {
          awb: "BD123",
          orderId,
          status: "DELIVERED",
        },
        { signature: "sha256=" + "0".repeat(64) },
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect(applyCarrierEvent).not.toHaveBeenCalled();
  });

  it("requires a tenant-scoped callback URL", async () => {
    vi.stubEnv("BLUEDART_WEBHOOK_TOKEN", token);

    const response = await POST(
      request(
        { awb: "BD123", orderId, status: "DELIVERED" },
        { tenant: false },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_tenant" });
  });

  it("acknowledges unknown statuses without reconciliation", async () => {
    vi.stubEnv("BLUEDART_WEBHOOK_TOKEN", token);

    const response = await POST(
      request({
        awb: "BD123",
        orderId,
        status: "Shipment Exception",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(applyCarrierEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed events missing AWB or order reference", async () => {
    vi.stubEnv("BLUEDART_WEBHOOK_TOKEN", token);

    const response = await POST(
      request({ status: "DELIVERED" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_bluedart_event",
    });
  });
});
