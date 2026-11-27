import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";
import { getServerEnv } from "@/lib/server/env";
import { createBlueDartShipment } from "@/lib/server/bluedart-shipments";

const RequestSchema = z
  .object({
    orderId: z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/),
    package: z.object({
      weightKg: z.number().positive().max(100),
      lengthCm: z.number().positive().max(1000),
      breadthCm: z.number().positive().max(1000),
      heightCm: z.number().positive().max(1000),
    }),
  })
  .strict();

export async function POST(request: Request) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "orders:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const store = getPlatformStore();
  const settings =
    store && typeof store.getTenantStoreSettings === "function"
      ? await store.getTenantStoreSettings(
          session.scope.id,
          session.scope.hostId,
          "",
        )
      : null;
  let credentials:
    | {
        baseUrl: string;
        customerCode: string;
        loginId: string;
        licenseKey: string;
      }
    | undefined;
  const configured = settings?.shipping.logistics;
  if (configured?.type === "bluedart") {
    try {
      const secret = await getSecretVault().getSecret(
        configured.credentialsRef,
      );
      const parsed = JSON.parse(secret) as {
        baseUrl?: string;
        customerCode?: string;
        loginId?: string;
        licenseKey?: string;
      };
      if (
        parsed.baseUrl &&
        parsed.customerCode &&
        parsed.loginId &&
        parsed.licenseKey
      ) {
        credentials = parsed as typeof credentials;
      }
    } catch {
      credentials = undefined;
    }
  }
  if (!credentials) {
    const env = getServerEnv();
    if (
      env.BLUEDART_API_BASE_URL &&
      env.BLUEDART_CUSTOMER_CODE &&
      env.BLUEDART_LOGIN_ID &&
      env.BLUEDART_LICENSE_KEY
    ) {
      credentials = {
        baseUrl: env.BLUEDART_API_BASE_URL,
        customerCode: env.BLUEDART_CUSTOMER_CODE,
        loginId: env.BLUEDART_LOGIN_ID,
        licenseKey: env.BLUEDART_LICENSE_KEY,
      };
    }
  }
  if (!credentials) {
    return NextResponse.json(
      { error: "bluedart_credentials_required" },
      { status: 409 },
    );
  }
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-bluedart-shipment", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const order = (await store.listTenantOrders(session.scope.id)).find(
    (candidate) => candidate.id === parsed.data.orderId,
  );
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (!["Confirmed", "Processing"].includes(order.status)) {
    return NextResponse.json(
      { error: "invalid_status_transition" },
      { status: 409 },
    );
  }
  if (order.fulfillment?.trackingNumber) {
    return NextResponse.json(
      { error: "shipment_already_created" },
      { status: 409 },
    );
  }
  let shipment;
  try {
    shipment = await createBlueDartShipment({
      credentials: {
        baseUrl: credentials.baseUrl,
        customerCode: credentials.customerCode,
        loginId: credentials.loginId,
        licenseKey: credentials.licenseKey,
      },
      order,
      package: parsed.data.package,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "bluedart_create_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const updated = await store.updateCustomerOrderStatus({
    tenantId: session.scope.id,
    orderId: order.id,
    status: "Shipped",
    fulfillment: shipment,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "carrier_order_update_failed" },
      { status: 409 },
    );
  }
  try {
    const adapter = await createTenantOrderAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    await adapter.updateOrderStatus(order.id, "Shipped", shipment);
  } catch {
    return NextResponse.json(
      { error: "tenant_order_sync_failed" },
      { status: 502 },
    );
  }
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: session.scope,
    action: "tenant.order.bluedart_shipment_created",
    resourceType: "customer_order",
    resourceId: order.id,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({
    order: { ...order, status: "Shipped", fulfillment: shipment },
  });
}
