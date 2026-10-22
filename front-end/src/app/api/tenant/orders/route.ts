import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";
import { z } from "zod";

const OrderIdSchema = z.string().regex(/^ORD-[A-Fa-f0-9-]{36}$/);
const UpdateOrderSchema = z
  .object({ status: z.enum(["Processing", "Shipped"]) })
  .strict();

function backendError(error: unknown) {
  if (error instanceof RestBackendError) {
    return NextResponse.json(
      {
        error:
          error.status >= 500
            ? "tenant_backend_error"
            : error.status === 404
              ? "order_not_found"
              : "tenant_backend_rejected",
      },
      {
        status: error.status >= 400 && error.status < 500 ? error.status : 502,
      },
    );
  }
  if (
    error instanceof Error &&
    error.message === "Tenant REST backend is not configured"
  ) {
    return NextResponse.json(
      { error: "connection_not_configured" },
      { status: 409 },
    );
  }
  console.error("Tenant order API failed", error);
  return NextResponse.json(
    { error: "tenant_backend_unavailable" },
    { status: 502 },
  );
}

export async function GET(request: Request) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const pageText = url.searchParams.get("page") ?? "1";
  const limitText = url.searchParams.get("limit") ?? "20";
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) {
    return NextResponse.json({ error: "invalid_pagination" }, { status: 400 });
  }
  const page = Number(pageText);
  const limit = Number(limitText);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return NextResponse.json({ error: "invalid_pagination" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-orders-list", session.userId),
    limit: 120,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const adapter = await createTenantOrderAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    return NextResponse.json(await adapter.listOrders(page, limit));
  } catch (error) {
    return backendError(error);
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
    .object({
      orderId: OrderIdSchema,
      ...UpdateOrderSchema.shape,
    })
    .strict()
    .safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-order-status-update",
      session.userId,
    ),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const adapter = await createTenantOrderAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const order = await adapter.updateOrderStatus(
      parsed.data.orderId,
      parsed.data.status,
    );
    const platformOrder = await store.updateCustomerOrderStatus({
      tenantId: session.scope.id,
      orderId: order.id,
      status: order.status,
    });
    if (platformOrder) {
      await store.appendAuditEvent({
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "tenant.order.status_updated",
        resourceType: "customer_order",
        resourceId: order.id,
        createdAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ order });
  } catch (error) {
    return backendError(error);
  }
}
