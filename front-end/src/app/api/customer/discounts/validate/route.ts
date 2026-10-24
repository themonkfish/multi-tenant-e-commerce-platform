import { NextResponse } from "next/server";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import {
  calculateDiscountAmount,
  findTenantDiscount,
  validateTenantDiscount,
} from "@/core/domain/discounts";
import {
  findProductVariantPricing,
  ProductVariantSelectionsSchema,
} from "@/core/domain/product";
import { TenantDataBackendError } from "@/core/ports/data";
import type { Product } from "@/core/ports/data";
import { canAccessPermission } from "@/core/tenancy/scope";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";
import { z } from "zod";

const ValidateDiscountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/),
    items: z
      .array(
        z.object({
          productId: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/),
          quantity: z.number().int().min(1).max(100),
          variantSelections: ProductVariantSelectionsSchema.optional(),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict();

function hasValidSelections(
  product: Product,
  selections: Record<string, string> | undefined,
): boolean {
  const options = product.options ?? [];
  const entries = Object.entries(selections ?? {});
  return (
    entries.length === options.length &&
    options.every(
      (option) =>
        Object.hasOwn(selections ?? {}, option.name) &&
        option.values.includes(selections?.[option.name] ?? ""),
    )
  );
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ValidateDiscountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "customer-discount-validate",
      session.userId,
    ),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

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
    if (error instanceof RestBackendError && error.status === 404) {
      return NextResponse.json({ error: "cart_changed" }, { status: 409 });
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
    if (error instanceof RestBackendError) {
      return NextResponse.json(
        { error: "tenant_backend_unavailable" },
        { status: 502 },
      );
    }
    if (error instanceof TenantDataBackendError) {
      return NextResponse.json(
        {
          error:
            error.status === 404
              ? "cart_changed"
              : "tenant_backend_unavailable",
        },
        { status: error.status === 404 ? 409 : 502 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "tenant_backend_unavailable" },
        { status: 502 },
      );
    }
    throw error;
  }
  if (
    products.some(
      (product, index) =>
        product.status !== "active" ||
        !hasValidSelections(
          product,
          parsed.data.items[index].variantSelections,
        ),
    )
  ) {
    return NextResponse.json({ error: "cart_changed" }, { status: 409 });
  }
  const currency = products[0]?.price.currency;
  if (
    !currency ||
    products.some((product) => product.price.currency !== currency)
  ) {
    return NextResponse.json({ error: "mixed_currency" }, { status: 409 });
  }
  const items = products.map((product, index) => ({
    price:
      findProductVariantPricing(
        product.variantPricing,
        parsed.data.items[index].variantSelections,
      )?.amount ?? product.price.amount,
    quantity: parsed.data.items[index].quantity,
  }));
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "Store",
  );
  const discount = findTenantDiscount(settings.discounts, parsed.data.code);
  const validationError = validateTenantDiscount(discount, subtotal);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (!discount) {
    return NextResponse.json(
      { error: "discount_code_invalid" },
      { status: 400 },
    );
  }
  if (
    (discount.type === "fixed_amount" ||
      discount.minimumSubtotal !== undefined) &&
    currency !== settings.locale.currency
  ) {
    return NextResponse.json(
      { error: "discount_currency_unsupported" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    code: discount.code,
    discountAmount: calculateDiscountAmount(discount, subtotal),
    subtotal,
  });
}
