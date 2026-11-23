import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { applyCarrierEvent } from "@/lib/server/carrier-event-handler";
import { getServerEnv } from "@/lib/server/env";
import {
  createStructuredLogger,
  getRequestCorrelationId,
  recordObservabilityMetric,
} from "@/lib/server/observability";
import {
  createShiprocketEventId,
  normalizeShiprocketStatus,
} from "@/lib/server/shiprocket-webhooks";

export const runtime = "nodejs";

const ShiprocketWebhookSchema = z
  .object({
    awb: z.string().trim().min(1).max(120),
    courier_name: z.string().trim().min(1).max(80).optional(),
    current_status: z.string().trim().min(1).max(100).optional(),
    shipment_status: z.string().trim().min(1).max(100).optional(),
    current_timestamp: z.string().trim().max(80).optional(),
    order_id: z
      .string()
      .trim()
      .regex(/^ORD-[A-Fa-f0-9-]{36}$/),
  })
  .refine(
    (event) =>
      event.current_status !== undefined || event.shipment_status !== undefined,
    "A current or shipment status is required",
  );

function verifyWebhookToken(
  received: string | null,
  expected: string,
): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  recordObservabilityMetric("shiprocket.webhook.received");
  const logger = createStructuredLogger({ requestId });

  let token: string;
  try {
    token = getServerEnv().SHIPROCKET_WEBHOOK_TOKEN ?? "";
  } catch {
    return NextResponse.json(
      { error: "shiprocket_webhook_not_configured" },
      { status: 503 },
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "shiprocket_webhook_not_configured" },
      { status: 503 },
    );
  }
  if (!verifyWebhookToken(request.headers.get("x-api-key"), token)) {
    recordObservabilityMetric("shiprocket.webhook.invalid_token");
    logger.warn("shiprocket.webhook.rejected", { reason: "invalid_token" });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const tenantId = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("tenantId"));
  if (!tenantId.success) {
    return NextResponse.json({ error: "invalid_tenant" }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (Buffer.byteLength(payload, "utf8") > 1_048_576) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const parsed = ShiprocketWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_shiprocket_event" },
      { status: 400 },
    );
  }

  const status = normalizeShiprocketStatus({
    currentStatus: parsed.data.current_status,
    shipmentStatus: parsed.data.shipment_status,
  });
  if (!status) {
    recordObservabilityMetric("shiprocket.webhook.ignored_status");
    return NextResponse.json({ received: true, ignored: true });
  }

  const response = await applyCarrierEvent(
    {
      eventId: createShiprocketEventId({
        awb: parsed.data.awb,
        orderId: parsed.data.order_id,
        currentStatus: parsed.data.current_status,
        shipmentStatus: parsed.data.shipment_status,
        currentTimestamp: parsed.data.current_timestamp,
      }),
      tenantId: tenantId.data,
      orderId: parsed.data.order_id,
      trackingNumber: parsed.data.awb,
      status,
      ...(parsed.data.courier_name
        ? { carrier: parsed.data.courier_name }
        : {}),
    },
    requestId,
  );
  if (response.ok) {
    recordObservabilityMetric("shiprocket.webhook.processed");
  }
  return response;
}
