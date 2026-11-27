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
  createBlueDartEventId,
  normalizeBlueDartStatus,
  verifyBlueDartWebhookSignature,
} from "@/lib/server/bluedart-webhooks";

export const runtime = "nodejs";

const BlueDartWebhookSchema = z
  .object({
    awb: z.string().trim().min(1).max(120).optional(),
    awbNumber: z.string().trim().min(1).max(120).optional(),
    waybillNumber: z.string().trim().min(1).max(120).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    orderId: z
      .string()
      .trim()
      .regex(/^ORD-[A-Fa-f0-9-]{36}$/)
      .optional(),
    referenceNumber: z
      .string()
      .trim()
      .regex(/^ORD-[A-Fa-f0-9-]{36}$/)
      .optional(),
    status: z.string().trim().min(1).max(100).optional(),
    shipmentStatus: z.string().trim().min(1).max(100).optional(),
    currentStatus: z.string().trim().min(1).max(100).optional(),
    scanStatus: z.string().trim().min(1).max(100).optional(),
    timestamp: z.string().trim().max(80).optional(),
  })
  .refine(
    (event) =>
      event.awb !== undefined ||
      event.awbNumber !== undefined ||
      event.waybillNumber !== undefined ||
      event.trackingNumber !== undefined,
    "An AWB or tracking number is required",
  )
  .refine(
    (event) =>
      event.orderId !== undefined || event.referenceNumber !== undefined,
    "An order ID or reference number is required",
  );

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  recordObservabilityMetric("bluedart.webhook.received");
  const logger = createStructuredLogger({ requestId });

  let token: string;
  try {
    token = getServerEnv().BLUEDART_WEBHOOK_TOKEN ?? "";
  } catch {
    return NextResponse.json(
      { error: "bluedart_webhook_not_configured" },
      { status: 503 },
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "bluedart_webhook_not_configured" },
      { status: 503 },
    );
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

  if (
    !verifyBlueDartWebhookSignature(
      payload,
      request.headers.get("x-bluedart-signature"),
      token,
    )
  ) {
    recordObservabilityMetric("bluedart.webhook.invalid_signature");
    logger.warn("bluedart.webhook.rejected", {
      reason: "invalid_signature",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const parsed = BlueDartWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_bluedart_event" },
      { status: 400 },
    );
  }
  const awb =
    parsed.data.awb ??
    parsed.data.awbNumber ??
    parsed.data.waybillNumber ??
    parsed.data.trackingNumber!;
  const orderId =
    parsed.data.orderId ?? parsed.data.referenceNumber!;
  const status = normalizeBlueDartStatus(parsed.data);
  if (!status) {
    recordObservabilityMetric("bluedart.webhook.ignored_status");
    return NextResponse.json({ received: true, ignored: true });
  }
  const response = await applyCarrierEvent(
    {
      eventId: createBlueDartEventId({
        awb,
        orderId,
        status: parsed.data.status,
        timestamp: parsed.data.timestamp,
      }),
      tenantId: tenantId.data,
      orderId,
      trackingNumber: awb,
      status,
      carrier: "BlueDart",
    },
    requestId,
  );
  if (response.ok) {
    recordObservabilityMetric("bluedart.webhook.processed");
  }
  return response;
}
