import { afterEach, describe, expect, it, vi } from "vitest";

const { applyCarrierEvent } = vi.hoisted(() => ({
  applyCarrierEvent: vi.fn(),
}));

vi.mock("@/lib/server/carrier-event-handler", () => ({ applyCarrierEvent }));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";
const token = "shiprocket-webhook-test-token";

function request(
  body: unknown,
  options: { token?: string; includeTenant?: boolean } = {},
) {
  const tenantQuery =
    options.includeTenant === false ? "" : `?tenantId=${tenantId}`;
  const payload = JSON.stringify(body);
  return new Request(
    `https://store.example.test/api/webhooks/logistics${tenantQuery}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        "x-api-key": options.token ?? token,
      },
      body: payload,
    },
  );
}

const event = {
  awb: "19041424751540",
  courier_name: "Delhivery Surface",
  current_status: "IN TRANSIT",
  current_status_id: 20,
  shipment_status: "IN TRANSIT",
  shipment_status_id: 18,
  current_timestamp: "23 05 2023 11:43:52",
  order_id: orderId,
  sr_order_id: 348456385,
  scans: [],
};

describe("POST /api/webhooks/logistics", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("adapts Shiprocket tracking events to the shared carrier handler", async () => {
    vi.stubEnv("SHIPROCKET_WEBHOOK_TOKEN", token);
    applyCarrierEvent.mockResolvedValue(
      Response.json({ received: true }, { status: 200 }),
    );

    const response = await POST(request(event));

    expect(response.status).toBe(200);
    expect(applyCarrierEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        orderId,
        trackingNumber: "19041424751540",
        carrier: "Delhivery Surface",
        status: "in_transit",
      }),
      expect.any(String),
    );
  });

  it("rejects requests with an invalid provider token", async () => {
    vi.stubEnv("SHIPROCKET_WEBHOOK_TOKEN", token);

    const response = await POST(request(event, { token: "wrong-token" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect(applyCarrierEvent).not.toHaveBeenCalled();
  });

  it("requires a tenant-scoped callback URL", async () => {
    vi.stubEnv("SHIPROCKET_WEBHOOK_TOKEN", token);

    const response = await POST(request(event, { includeTenant: false }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_tenant" });
  });

  it("acknowledges unrecognized statuses without changing an order", async () => {
    vi.stubEnv("SHIPROCKET_WEBHOOK_TOKEN", token);

    const response = await POST(
      request({
        ...event,
        current_status: "Shipment Exception",
        shipment_status: "Shipment Exception",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(applyCarrierEvent).not.toHaveBeenCalled();
  });
});
