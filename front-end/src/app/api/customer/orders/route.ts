import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { CustomerOrderSchema } from "@/core/domain/tenant-identities";
import type { Product } from "@/core/ports/data";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";
import {
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  StripePaymentConfigurationError,
} from "@/lib/server/stripe-payments";
import { ZodError, z } from "zod";

const CreateOrderSchema = z
  .object({
    idempotencyKey: z.uuid(),
    items: z
      .array(
        z.object({
          productId: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    ({ items }) =>
      new Set(items.map((item) => item.productId)).size === items.length,
    "Cart items must contain unique product IDs",
  )
  .refine(
    ({ items }) =>
      items.reduce((total, item) => total + item.quantity, 0) <= 100,
    "Cart contains too many items",
  );

export async function GET() {
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orders = await getPlatformStore().listCustomerOrders(
    session.scope.id,
    session.userId,
  );
  return NextResponse.json({ data: orders });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json(
      { error: "customer_sign_in_required" },
      { status: 401 },
    );
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateOrderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_cart", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  const orderId = `ORD-${parsed.data.idempotencyKey}`;
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "customer-order-create", session.userId),
    limit: 10,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let order = await store.getCustomerOrder(
    session.scope.id,
    session.userId,
    orderId,
  );
  if (order) {
    const sameCart =
      order.items.length === parsed.data.items.length &&
      order.items.every(
        (item, index) =>
          item.productId === parsed.data.items[index].productId &&
          item.quantity === parsed.data.items[index].quantity,
      );
    if (!sameCart) {
      return NextResponse.json(
        { error: "idempotency_key_conflict" },
        { status: 409 },
      );
    }
    if (order.paymentStatus === "paid") {
      return NextResponse.json({ order }, { status: 200 });
    }
    if (order.paymentSessionId) {
      try {
        const checkout = await retrieveStripeCheckoutSession(
          order.paymentSessionId,
        );
        if (checkout.status === "open" && checkout.url) {
          return NextResponse.json(
            { order, checkoutUrl: checkout.url },
            { status: 200 },
          );
        }
        if (checkout.status === "complete") {
          return NextResponse.json(
            { error: "payment_confirmation_pending" },
            { status: 202 },
          );
        }
        await store.updateCustomerOrderPayment({
          tenantId: order.tenantId,
          customerId: order.customerId,
          orderId: order.id,
          sessionId: order.paymentSessionId,
          status: "failed",
        });
        order = await store.getCustomerOrder(
          session.scope.id,
          session.userId,
          orderId,
        );
      } catch (error) {
        if (error instanceof StripePaymentConfigurationError) {
          return NextResponse.json(
            { error: "payment_not_configured" },
            { status: 503 },
          );
        }
        console.error("Could not retrieve Stripe Checkout session", error);
        return NextResponse.json(
          { error: "payment_provider_unavailable" },
          { status: 502 },
        );
      }
      if (!order) {
        return NextResponse.json({ error: "order_not_found" }, { status: 404 });
      }
      if (order.paymentStatus === "paid") {
        return NextResponse.json({ order }, { status: 200 });
      }
    }
  }

  if (!order) {
    let products: Product[];
    try {
      const catalog = await createTenantCatalogAdapter(
        session.scope.id,
        session.scope.hostId,
      );
      products = await Promise.all(
        parsed.data.items.map(({ productId }) =>
          catalog.getProduct(session.scope.id, productId),
        ),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Tenant REST backend is not configured"
      ) {
        return NextResponse.json(
          { error: "connection_not_configured" },
          { status: 409 },
        );
      }
      if (error instanceof RestBackendError && error.status === 404) {
        return NextResponse.json(
          {
            error: "cart_changed",
            message: "One or more products are unavailable.",
          },
          { status: 409 },
        );
      }
      if (error instanceof RestBackendError) {
        return NextResponse.json(
          { error: "tenant_backend_unavailable" },
          { status: 502 },
        );
      }
      if (
        error instanceof ZodError ||
        (error instanceof Error && error.message.startsWith("Tenant backend"))
      ) {
        return NextResponse.json(
          { error: "tenant_backend_unavailable" },
          { status: 502 },
        );
      }
      throw error;
    }

    if (products.some((product) => product.status !== "active")) {
      return NextResponse.json(
        {
          error: "cart_changed",
          message: "One or more products are unavailable.",
        },
        { status: 409 },
      );
    }

    const currency = products[0]?.price.currency;
    if (
      !currency ||
      products.some((product) => product.price.currency !== currency)
    ) {
      return NextResponse.json(
        {
          error: "mixed_currency",
          message: "All order items must use the same currency.",
        },
        { status: 409 },
      );
    }

    const items = products.map((product, index) => ({
      productId: product.id,
      title: product.title,
      slug: product.slug,
      quantity: parsed.data.items[index].quantity,
      unitPrice: product.price.amount,
      currency: product.price.currency,
    }));
    const total = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (
      !Number.isSafeInteger(total) ||
      total > 2_147_483_647 ||
      total < 1 ||
      items.some((item) => item.unitPrice < 1)
    ) {
      return NextResponse.json(
        {
          error:
            total < 1
              ? "free_checkout_not_supported"
              : "order_total_out_of_range",
        },
        { status: 400 },
      );
    }

    const newOrder = CustomerOrderSchema.parse({
      id: orderId,
      tenantId: session.scope.id,
      customerId: session.userId,
      status: "Confirmed",
      createdAt: new Date().toISOString(),
      items,
      total,
      currency,
      itemCount,
      paymentStatus: "pending",
      paymentAttempt: 0,
      backendSyncStatus: "not_configured",
    });
    const result = await store.createCustomerOrder(newOrder);
    order = result.order;
    const storedCartMatches =
      order.items.length === parsed.data.items.length &&
      order.items.every(
        (item, index) =>
          item.productId === parsed.data.items[index].productId &&
          item.quantity === parsed.data.items[index].quantity,
      );
    if (!storedCartMatches) {
      return NextResponse.json(
        { error: "idempotency_key_conflict" },
        { status: 409 },
      );
    }
    if (result.created) {
      await store.appendAuditEvent({
        id: randomUUID(),
        actorId: session.userId,
        scope: session.scope,
        action: "customer.order.created",
        resourceType: "customer_order",
        resourceId: result.order.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const prepared = await store.prepareCustomerOrderPayment({
    tenantId: session.scope.id,
    customerId: session.userId,
    orderId: order.id,
  });
  if (!prepared) {
    return NextResponse.json(
      { error: "payment_confirmation_pending" },
      { status: 202 },
    );
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const successUrl = new URL("/en/checkout/success", origin);
  successUrl.searchParams.set("orderId", order.id);
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL("/en/cart?payment=cancelled", origin);
  try {
    const checkout = await createStripeCheckoutSession({
      order: prepared.order,
      attempt: prepared.attempt,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    });
    if (!checkout.url) {
      throw new Error("Stripe did not return a hosted Checkout URL");
    }
    const savedOrder = await store.saveCustomerOrderPaymentSession({
      tenantId: order.tenantId,
      customerId: order.customerId,
      orderId: order.id,
      attempt: prepared.attempt,
      sessionId: checkout.id,
    });
    if (!savedOrder) {
      return NextResponse.json(
        { error: "payment_session_conflict" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { order: savedOrder, checkoutUrl: checkout.url },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof StripePaymentConfigurationError) {
      return NextResponse.json(
        { error: "payment_not_configured" },
        { status: 503 },
      );
    }
    console.error("Stripe Checkout session creation failed", {
      tenantId: order.tenantId,
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "payment_provider_unavailable" },
      { status: 502 },
    );
  }
}
