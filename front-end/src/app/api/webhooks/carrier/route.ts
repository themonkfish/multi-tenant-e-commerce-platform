import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/server/env";
import { OrderFulfillmentSchema } from "@/core/domain/tenant-identities";
import {
  verifyCarrierWebhookSignature,
  type CarrierEventStatus,
} from "@/lib/server/carrier-webhooks";
import {
  createStructuredLogger,
  getRequestCorrelationId,
  recordObservabilityMetric,
} from "@/lib/server/observability";
import { applyCarrierEvent } from "@/lib/server/carrier-event-handler";

export const runtime = "nodejs";

const CarrierEventSchema = z
  .object({
    eventId: z.string().trim().min(1).max(128),
    tenantId: z.uuid(),
    orderId: z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/),
    trackingNumber: z.string().trim().min(1).max(120),
    status: z.enum([
      "label_created",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "returned",
    ]),
    carrier: z.string().trim().min(1).max(80).optional(),
    fulfillment: OrderFulfillmentSchema.partial().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  recordObservabilityMetric("carrier.webhook.received");
  const logger = createStructuredLogger({ requestId });
  let secret: string;
  try {
    secret = getServerEnv().CARRIER_WEBHOOK_SECRET ?? "";
  } catch {
    return NextResponse.json(
      { error: "carrier_webhook_not_configured" },
      { status: 503 },
    );
  }
  if (!secret) {
    return NextResponse.json(
      { error: "carrier_webhook_not_configured" },
      { status: 503 },
    );
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
  if (
    !verifyCarrierWebhookSignature(
      payload,
      request.headers.get("x-carrier-signature"),
      secret,
    )
  ) {
    recordObservabilityMetric("carrier.webhook.invalid_signature");
    logger.warn("carrier.webhook.rejected", {
      reason: "invalid_signature",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const parsed = CarrierEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_carrier_event" },
      { status: 400 },
    );
  }

  return applyCarrierEvent(
    {
      ...parsed.data,
      status: parsed.data.status as CarrierEventStatus,
      ...(parsed.data.fulfillment?.trackingUrl
        ? { fulfillment: { trackingUrl: parsed.data.fulfillment.trackingUrl } }
        : {}),
    },
    requestId,
  );
}
