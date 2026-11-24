import { NextResponse } from "next/server";
import { ProductUpdateSchema } from "@/core/domain/product";
import { canAccessPermission } from "@/core/tenancy/scope";
import { TenantDataBackendError } from "@/core/ports/data";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantCatalogSession } from "@/lib/server/session";
import { createTenantStorageAdapter } from "@/adapters/storage/tenant-storage-provider";
import {
  getTenantUploadedImageKey,
  validateTenantUploadedImageUrl,
} from "@/lib/server/product-images";
import { invalidateTenantCatalogCache } from "@/lib/server/tenant-cache";

type ProductRouteContext = {
  params: Promise<{ productId: string }>;
};

function backendError(error: unknown) {
  if (error instanceof TenantDataBackendError) {
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
  const session = await getTenantCatalogSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "catalog:read")) {
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
      (error.message === "Tenant REST backend is not configured" ||
        error.message === "Tenant database provider is not configured")
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
  const session = await getTenantCatalogSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "catalog:write")) {
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
    if (
      parsed.data.imageUrl &&
      getTenantUploadedImageKey(session.scope.id, parsed.data.imageUrl)
    ) {
      const storage = await createTenantStorageAdapter(
        session.scope.id,
        session.scope.hostId,
      );
      try {
        validateTenantUploadedImageUrl(
          storage,
          session.scope.id,
          parsed.data.imageUrl,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Product image")
        ) {
          return NextResponse.json(
            { error: "invalid_product_image" },
            { status: 400 },
          );
        }
        throw error;
      }
    }
    const existing = await catalog.getProduct(session.scope.id, productId);
    const product = await catalog.updateProduct(
      session.scope.id,
      productId,
      parsed.data,
    );
    invalidateTenantCatalogCache(session.scope.hostId, session.scope.id);
    const oldKey =
      existing.imageUrl &&
      getTenantUploadedImageKey(session.scope.id, existing.imageUrl);
    const newKey =
      parsed.data.imageUrl &&
      getTenantUploadedImageKey(session.scope.id, parsed.data.imageUrl);
    if (oldKey && oldKey !== newKey) {
      try {
        const storage = await createTenantStorageAdapter(
          session.scope.id,
          session.scope.hostId,
        );
        await storage.delete(oldKey);
      } catch (error) {
        console.error("Tenant product image cleanup failed", {
          tenantId: session.scope.id,
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return NextResponse.json({ product });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Tenant REST backend is not configured" ||
        error.message === "Tenant database provider is not configured")
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
  const session = await getTenantCatalogSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "catalog:write")) {
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
    const existing = await catalog.getProduct(session.scope.id, productId);
    await catalog.deleteProduct(session.scope.id, productId);
    invalidateTenantCatalogCache(session.scope.hostId, session.scope.id);
    if (
      existing.imageUrl &&
      getTenantUploadedImageKey(session.scope.id, existing.imageUrl)
    ) {
      const key = getTenantUploadedImageKey(
        session.scope.id,
        existing.imageUrl,
      );
      if (key) {
        try {
          const storage = await createTenantStorageAdapter(
            session.scope.id,
            session.scope.hostId,
          );
          await storage.delete(key);
        } catch (error) {
          console.error("Tenant product image cleanup failed", {
            tenantId: session.scope.id,
            productId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Tenant REST backend is not configured" ||
        error.message === "Tenant database provider is not configured")
    ) {
      return NextResponse.json(
        { error: "connection_not_configured" },
        { status: 409 },
      );
    }
    return backendError(error);
  }
}
