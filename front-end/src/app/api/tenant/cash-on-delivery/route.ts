import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessPermission } from "@/core/tenancy/scope";
import { CustomerOrderSchema } from "@/core/domain/tenant-identities";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";
import { z } from "zod";

const OrderIdSchema = z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/);

function parsePagination(request: Request) {
  const url = new URL(request.url);
  const pageText = url.searchParams.get("page") ?? "1";
  const limitText = url.searchParams.get("limit") ?? "20";
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) return null;
  const page = Number(pageText);
  const limit = Number(limitText);
  return Number.isSafeInteger(page) &&
    page > 0 &&
    Number.isSafeInteger(limit) &&
    limit > 0 &&
    limit <= 100
    ? { page, limit }
    : null;
}

export async function GET(request: Request) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const pagination = parsePagination(request);
  if (!pagination) {
    return NextResponse.json({ error: "invalid_pagination" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-cod-orders-list", session.userId),
    limit: 120,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const result = await store.listTenantCashOnDeliveryOrders({
      tenantId: session.scope.id,
      ...pagination,
    });
    return NextResponse.json({
      ...result,
      data: result.data.map((order) => CustomerOrderSchema.parse(order)),
    });
  } catch (error) {
    console.error("Tenant cash-on-delivery order list failed", error);
    return NextResponse.json(
      { error: "cash_on_delivery_orders_unavailable" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
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
  const parsed = z
    .object({ orderId: OrderIdSchema })
    .strict()
    .safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-cod-order-collection",
      session.userId,
    ),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const collectedAt = new Date().toISOString();
  try {
    const order = await store.markCustomerOrderCashOnDeliveryCollected({
      tenantId: session.scope.id,
      orderId: parsed.data.orderId,
      auditEvent: {
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "tenant.order.cash_on_delivery_collected",
        resourceType: "customer_order_payment",
        resourceId: parsed.data.orderId,
        createdAt: collectedAt,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "cod_order_not_due" }, { status: 409 });
    }
    return NextResponse.json({ order });
  } catch (error) {
    console.error("Tenant cash-on-delivery collection failed", error);
    return NextResponse.json(
      { error: "cash_on_delivery_collection_failed" },
      { status: 500 },
    );
  }
}
