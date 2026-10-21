import { NextResponse } from "next/server";
import { ProductUpdateSchema } from "@/core/domain/product";
import { canAccessPermission } from "@/core/tenancy/scope";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

type ProductRouteContext = {
  params: Promise<{ productId: string }>;
};

function backendError(error: unknown) {
  if (error instanceof RestBackendError) {
    const status =
      error.status === 404
        ? 404
        : error.status >= 400 && error.status < 500
          ? error.status
          : 502;
    return NextResponse.json(
      {
        error:
          error.status >= 500
            ? "tenant_backend_error"
            : "tenant_backend_rejected",
      },
      { status },
    );
  }
  return NextResponse.json(
    { error: "tenant_backend_unavailable" },
    { status: 502 },
  );
}

export async function GET(_request: Request, context: ProductRouteContext) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { productId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }
  const allowed = await getPlatformStore().consumeRateLimit({
    key: createRateLimitKey(_request, "tenant-product-read", session.userId),
    limit: 120,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }
  try {
    const catalog = await createTenantCatalogAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const product = await catalog.getProduct(session.scope.id, productId);
    return NextResponse.json({ product });
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
    return backendError(error);
  }
}

export async function PATCH(request: Request, context: ProductRouteContext) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
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
  const parsed = ProductUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { productId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }
  const allowed = await getPlatformStore().consumeRateLimit({
    key: createRateLimitKey(request, "tenant-products-update", session.userId),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const catalog = await createTenantCatalogAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const product = await catalog.updateProduct(
      session.scope.id,
      productId,
      parsed.data,
    );
    return NextResponse.json({ product });
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
    return backendError(error);
  }
}

export async function DELETE(request: Request, context: ProductRouteContext) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "tenant:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { productId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }
  const allowed = await getPlatformStore().consumeRateLimit({
    key: createRateLimitKey(request, "tenant-products-delete", session.userId),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const catalog = await createTenantCatalogAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    await catalog.deleteProduct(session.scope.id, productId);
    return new Response(null, { status: 204 });
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
    return backendError(error);
  }
}
