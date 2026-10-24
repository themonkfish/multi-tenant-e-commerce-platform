import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import {
  CustomerDeliveryAddressSchema,
  CustomerOrderSchema,
} from "@/core/domain/tenant-identities";
import {
  findProductVariantPricing,
  ProductVariantSelectionsSchema,
} from "@/core/domain/product";
import {
  calculateDiscountAmount,
  findTenantDiscount,
  validateTenantDiscount,
} from "@/core/domain/discounts";
import { calculateTaxAmount } from "@/core/domain/tax";
import type { Product } from "@/core/ports/data";
import type { InventoryReservationItem } from "@/core/ports/data";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";
import { syncCustomerOrderToTenant } from "@/lib/server/customer-order-sync";
import {
  createDemoCheckoutSessionId,
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
} from "@/lib/server/demo-checkout";
import {
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  StripePaymentConfigurationError,
} from "@/lib/server/stripe-payments";
import { ZodError, z } from "zod";

const CreateOrderSchema = z
  .object({
    idempotencyKey: z.uuid(),
    paymentMethod: z.enum(["stripe", "cash_on_delivery"]).default("stripe"),
    discountCode: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((code) => code.toUpperCase())
      .optional(),
    deliveryAddress: CustomerDeliveryAddressSchema,
    items: z
      .array(
        z.object({
          productId: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/),
          quantity: z.number().int().min(1).max(100),
          expectedUnitPrice: z
            .number()
            .int()
            .min(0)
            .max(2_147_483_647)
            .optional(),
          variantSelections: ProductVariantSelectionsSchema.optional(),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(({ items }) => {
    const keys = items.map((item) =>
      JSON.stringify([
        item.productId,
        Object.entries(item.variantSelections ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ]),
    );
    return new Set(keys).size === keys.length;
  }, "Cart items must contain unique product variants")
  .refine(
    ({ items }) =>
      items.reduce((total, item) => total + item.quantity, 0) <= 100,
    "Cart contains too many items",
  )
  .refine(
    ({ paymentMethod, deliveryAddress }) =>
      paymentMethod !== "cash_on_delivery" || deliveryAddress?.country === "IN",
    {
      message: "Cash on delivery is currently available only in India",
      path: ["deliveryAddress", "country"],
    },
  );

function sameDeliveryAddress(
  left: z.infer<typeof CustomerDeliveryAddressSchema> | undefined,
  right: z.infer<typeof CustomerDeliveryAddressSchema> | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.fullName === right.fullName &&
    left.line1 === right.line1 &&
    (left.line2 ?? "") === (right.line2 ?? "") &&
    left.city === right.city &&
    left.state === right.state &&
    left.postalCode === right.postalCode &&
    left.country === right.country &&
    left.phone === right.phone
  );
}

function sameVariantSelections(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const sorted = (value: Record<string, string> | undefined) =>
    Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function selectionsMatchProduct(
  product: Product,
  selections: Record<string, string> | undefined,
): boolean {
  const options = product.options ?? [];
  const entries = Object.entries(selections ?? {});
  if (entries.length !== options.length) return false;
  return options.every(
    (option) =>
      option.values.includes(selections?.[option.name] ?? "") &&
      Object.hasOwn(selections ?? {}, option.name),
  );
}

function hasAvailableStock(
  product: Product,
  selections: Record<string, string> | undefined,
  quantity: number,
): boolean {
  if (!product.variants?.length) return true;
  const requested = Object.entries(selections ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const variant = product.variants.find(
    (candidate) =>
      JSON.stringify(
        Object.entries(candidate.selections).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ) === JSON.stringify(requested),
  );
  return Boolean(variant && variant.stock >= quantity);
}

function inventoryItems(
  products: Product[],
  items: z.infer<typeof CreateOrderSchema>["items"],
): InventoryReservationItem[] {
  return products.flatMap((product, index) =>
    product.variants?.length
      ? [
          {
            productId: product.id,
            selections: items[index].variantSelections ?? {},
            quantity: items[index].quantity,
          },
        ]
      : [],
  );
}

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
  const demoCheckoutEnabled = isLocalDemoCheckoutEnabled(
    request.headers.get("host"),
  );
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

  let orderCreated = false;
  let order = await store.getCustomerOrder(
    session.scope.id,
    session.userId,
    orderId,
  );
  if (order) {
    const sameCart =
      (order.paymentMethod ?? "stripe") === parsed.data.paymentMethod &&
      order.items.length === parsed.data.items.length &&
      order.items.every(
        (item, index) =>
          item.productId === parsed.data.items[index].productId &&
          item.quantity === parsed.data.items[index].quantity &&
          sameVariantSelections(
            item.variantSelections,
            parsed.data.items[index].variantSelections,
          ),
      );
    const sameAddress = sameDeliveryAddress(
      order.deliveryAddress,
      parsed.data.deliveryAddress,
    );
    const sameDiscount =
      (order.discountCode ?? "") === (parsed.data.discountCode ?? "");
    if (!sameCart || !sameAddress || !sameDiscount) {
      return NextResponse.json(
        { error: "idempotency_key_conflict" },
        { status: 409 },
      );
    }
    if (order.discountCode) {
      const reserved = await store.reserveDiscountRedemption({
        tenantId: order.tenantId,
        orderId: order.id,
        code: order.discountCode,
        now: new Date().toISOString(),
      });
      if (!reserved) {
        return NextResponse.json(
          { error: "discount_limit_reached" },
          { status: 409 },
        );
      }
      if (order.paymentStatus === "paid" || order.paymentStatus === "cod_due") {
        await store.commitDiscountRedemption(order.tenantId, order.id);
      }
    }
    if (order.paymentMethod === "cash_on_delivery") {
      if (order.paymentStatus === "cod_due") {
        if (order.items.some((item) => item.inventoryTracked)) {
          const catalog = await createTenantCatalogAdapter(
            session.scope.id,
            session.scope.hostId,
          );
          await catalog.commitInventory(`${order.id}-cod`);
        }
        if (order.backendSyncStatus !== "synced") {
          order = await syncCustomerOrderToTenant({
            store,
            tenantId: order.tenantId,
            hostId: session.scope.hostId,
            order,
          });
        }
        return NextResponse.json({ order }, { status: 200 });
      }
      if (order.paymentStatus === "paid") {
        return NextResponse.json({ order }, { status: 200 });
      }
    }
    if (order.paymentStatus === "paid") {
      return NextResponse.json({ order }, { status: 200 });
    }
    if (order.paymentSessionId) {
      if (
        demoCheckoutEnabled &&
        isDemoCheckoutSession(order.paymentSessionId)
      ) {
        if (order.paymentStatus === "pending") {
          const origin = request.headers.get("origin");
          if (!origin) {
            return NextResponse.json(
              { error: "invalid_origin" },
              { status: 403 },
            );
          }
          return NextResponse.json({
            order,
            checkoutUrl: getDemoCheckoutUrl(origin, order.id),
          });
        }
      } else {
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
          return NextResponse.json(
            { error: "order_not_found" },
            { status: 404 },
          );
        }
        if (order.paymentStatus === "paid") {
          return NextResponse.json({ order }, { status: 200 });
        }
      }
    }
  }

  if (!order) {
    let products: Product[];
    let catalog: Awaited<ReturnType<typeof createTenantCatalogAdapter>>;
    try {
      catalog = await createTenantCatalogAdapter(
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

    if (
      products.some(
        (product, index) =>
          !selectionsMatchProduct(
            product,
            parsed.data.items[index].variantSelections,
          ),
      )
    ) {
      return NextResponse.json(
        {
          error: "cart_changed",
          message: "One or more product options are invalid or unavailable.",
        },
        { status: 409 },
      );
    }

    if (
      products.some(
        (product, index) =>
          !hasAvailableStock(
            product,
            parsed.data.items[index].variantSelections,
            parsed.data.items[index].quantity,
          ),
      )
    ) {
      return NextResponse.json(
        { error: "insufficient_stock" },
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
    if (
      parsed.data.paymentMethod === "cash_on_delivery" &&
      currency !== "INR"
    ) {
      return NextResponse.json(
        { error: "cash_on_delivery_currency_unsupported" },
        { status: 400 },
      );
    }

    const items = products.map((product, index) => {
      const pricing = findProductVariantPricing(
        product.variantPricing,
        parsed.data.items[index].variantSelections,
      );
      const sku = pricing?.sku ?? product.sku;
      return {
        productId: product.id,
        title: product.title,
        slug: product.slug,
        quantity: parsed.data.items[index].quantity,
        ...(parsed.data.items[index].variantSelections
          ? { variantSelections: parsed.data.items[index].variantSelections }
          : {}),
        ...(sku ? { sku } : {}),
        ...(product.variants?.length ? { inventoryTracked: true } : {}),
        unitPrice: pricing?.amount ?? product.price.amount,
        currency: product.price.currency,
      };
    });
    if (
      items.some(
        (item, index) =>
          parsed.data.items[index].expectedUnitPrice !== undefined &&
          parsed.data.items[index].expectedUnitPrice !== item.unitPrice,
      )
    ) {
      return NextResponse.json(
        {
          error: "cart_changed",
          message: "One or more product prices changed.",
        },
        { status: 409 },
      );
    }
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const shippingSettings = await store.getTenantStoreSettings(
      session.scope.id,
      session.scope.hostId,
      "Store",
    );
    if (
      currency !== shippingSettings.locale.currency &&
      (shippingSettings.shipping.flatRate > 0 ||
        shippingSettings.shipping.freeShippingThreshold !== undefined)
    ) {
      return NextResponse.json(
        { error: "shipping_currency_unsupported" },
        { status: 400 },
      );
    }
    const shippingAmount =
      shippingSettings.shipping.freeShippingThreshold !== undefined &&
      subtotal >= shippingSettings.shipping.freeShippingThreshold
        ? 0
        : shippingSettings.shipping.flatRate;
    const discountCode = parsed.data.discountCode;
    const discount = discountCode
      ? findTenantDiscount(shippingSettings.discounts, discountCode)
      : undefined;
    const discountError = discountCode
      ? validateTenantDiscount(discount, subtotal)
      : null;
    if (discountError) {
      return NextResponse.json({ error: discountError }, { status: 400 });
    }
    if (
      discount &&
      (discount.type === "fixed_amount" ||
        discount.minimumSubtotal !== undefined) &&
      currency !== shippingSettings.locale.currency
    ) {
      return NextResponse.json(
        { error: "discount_currency_unsupported" },
        { status: 400 },
      );
    }
    const discountAmount = discount
      ? calculateDiscountAmount(discount, subtotal)
      : 0;
    const taxRateBasisPoints = shippingSettings.tax.rateBasisPoints;
    const taxAmount = calculateTaxAmount(
      subtotal - discountAmount,
      taxRateBasisPoints,
    );
    const total = subtotal - discountAmount + taxAmount + shippingAmount;
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(subtotal) ||
      !Number.isSafeInteger(shippingAmount) ||
      !Number.isSafeInteger(taxAmount) ||
      total > 2_147_483_647 ||
      subtotal > 2_147_483_647 ||
      taxAmount > 2_147_483_647 ||
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
      subtotal,
      shippingAmount,
      ...(discountCode ? { discountCode } : {}),
      discountAmount,
      taxRateBasisPoints,
      taxAmount,
      total,
      currency,
      itemCount,
      paymentMethod: parsed.data.paymentMethod,
      paymentStatus:
        parsed.data.paymentMethod === "cash_on_delivery"
          ? "cod_due"
          : "pending",
      paymentAttempt: 0,
      deliveryAddress: parsed.data.deliveryAddress,
      backendSyncStatus:
        parsed.data.paymentMethod === "cash_on_delivery"
          ? "pending"
          : "not_configured",
    });
    const reservationId =
      parsed.data.paymentMethod === "cash_on_delivery"
        ? `${orderId}-cod`
        : `${orderId}-1`;
    const stockItems = inventoryItems(products, parsed.data.items);
    if (
      discountCode &&
      !(await store.reserveDiscountRedemption({
        tenantId: session.scope.id,
        orderId,
        code: discountCode,
        now: new Date().toISOString(),
      }))
    ) {
      return NextResponse.json(
        { error: "discount_limit_reached" },
        { status: 409 },
      );
    }
    const reserved =
      stockItems.length === 0 ||
      (await catalog.reserveInventory({ reservationId, items: stockItems }));
    if (!reserved) {
      if (discountCode) {
        await store.releaseDiscountRedemption(session.scope.id, orderId);
      }
      return NextResponse.json(
        { error: "insufficient_stock" },
        { status: 409 },
      );
    }
    let result;
    try {
      result = await store.createCustomerOrder(newOrder);
    } catch (error) {
      await catalog.releaseInventory(reservationId);
      if (discountCode) {
        await store.releaseDiscountRedemption(session.scope.id, orderId);
      }
      throw error;
    }
    order = result.order;
    orderCreated = result.created;
    const storedCartMatches =
      order.paymentMethod === parsed.data.paymentMethod &&
      order.items.length === parsed.data.items.length &&
      order.items.every(
        (item, index) =>
          item.productId === parsed.data.items[index].productId &&
          item.quantity === parsed.data.items[index].quantity &&
          sameVariantSelections(
            item.variantSelections,
            parsed.data.items[index].variantSelections,
          ),
      );
    const storedAddressMatches = sameDeliveryAddress(
      order.deliveryAddress,
      parsed.data.deliveryAddress,
    );
    const storedAmountsMatch =
      order.total === newOrder.total &&
      (order.subtotal ?? order.total - (order.shippingAmount ?? 0)) ===
        newOrder.subtotal &&
      (order.shippingAmount ?? 0) === newOrder.shippingAmount &&
      (order.taxAmount ?? 0) === newOrder.taxAmount &&
      (order.taxRateBasisPoints ?? 0) === newOrder.taxRateBasisPoints;
    const storedDiscountMatches =
      (order.discountCode ?? "") === (newOrder.discountCode ?? "") &&
      (order.discountAmount ?? 0) === newOrder.discountAmount;
    if (
      !storedCartMatches ||
      !storedAddressMatches ||
      !storedAmountsMatch ||
      !storedDiscountMatches
    ) {
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
  if (order.paymentMethod === "cash_on_delivery") {
    if (order.discountCode) {
      await store.commitDiscountRedemption(order.tenantId, order.id);
    }
    if (order.items.some((item) => item.inventoryTracked)) {
      const catalog = await createTenantCatalogAdapter(
        session.scope.id,
        session.scope.hostId,
      );
      await catalog.commitInventory(`${order.id}-cod`);
    }
    const syncedOrder =
      order.backendSyncStatus === "synced"
        ? order
        : await syncCustomerOrderToTenant({
            store,
            tenantId: order.tenantId,
            hostId: session.scope.hostId,
            order,
          });
    return NextResponse.json(
      { order: syncedOrder, cashOnDelivery: true },
      { status: orderCreated ? 201 : 200 },
    );
  }
  if (!orderCreated) {
    const items = order.items.flatMap((item) =>
      item.inventoryTracked
        ? [
            {
              productId: item.productId,
              selections: item.variantSelections ?? {},
              quantity: item.quantity,
            },
          ]
        : [],
    );
    if (items.length > 0) {
      const catalog = await createTenantCatalogAdapter(
        session.scope.id,
        session.scope.hostId,
      );
      const nextAttempt = order.paymentAttempt + 1;
      if (order.paymentAttempt > 0) {
        await catalog.releaseInventory(`${order.id}-${order.paymentAttempt}`);
      }
      const reserved = await catalog.reserveInventory({
        reservationId: `${order.id}-${nextAttempt}`,
        items,
      });
      if (!reserved) {
        return NextResponse.json(
          { error: "insufficient_stock" },
          { status: 409 },
        );
      }
    }
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
  if (demoCheckoutEnabled) {
    const sessionId = createDemoCheckoutSessionId(prepared.attempt);
    const savedOrder = await store.saveCustomerOrderPaymentSession({
      tenantId: order.tenantId,
      customerId: order.customerId,
      orderId: order.id,
      attempt: prepared.attempt,
      sessionId,
    });
    if (!savedOrder) {
      return NextResponse.json(
        { error: "payment_session_conflict" },
        { status: 409 },
      );
    }
    return NextResponse.json({
      order: savedOrder,
      checkoutUrl: getDemoCheckoutUrl(origin, order.id),
    });
  }
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
      if (order.discountCode) {
        await store.releaseDiscountRedemption(order.tenantId, order.id);
      }
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

function getDemoCheckoutUrl(origin: string, orderId: string): string {
  const checkoutUrl = new URL("/en/checkout/demo", origin);
  checkoutUrl.searchParams.set("orderId", orderId);
  return checkoutUrl.toString();
}
