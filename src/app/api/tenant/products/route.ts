import { NextResponse } from "next/server";
import { ProductInputSchema } from "@/core/domain/product";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";

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

export async function GET(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return NextResponse.json({ error: "invalid_pagination" }, { status: 400 });
  }
  const allowed = await getPlatformStore().consumeRateLimit({
    key: createRateLimitKey(request, "tenant-products-list", session.userId),
    limit: 120,
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
    const result = await catalog.listProducts({
      tenantId: session.scope.id,
      page,
      limit,
    });
    return NextResponse.json(result);
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
    if (
      error instanceof Error &&
      error.message.startsWith("Product pagination")
    ) {
      return NextResponse.json(
        { error: "invalid_pagination" },
        { status: 400 },
      );
    }
    return backendError(error);
  }
}

export async function POST(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const parsed = ProductInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const allowed = await getPlatformStore().consumeRateLimit({
    key: createRateLimitKey(request, "tenant-products-create", session.userId),
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
    const product = await catalog.createProduct({
      ...parsed.data,
      tenantId: session.scope.id,
    });
    return NextResponse.json({ product }, { status: 201 });
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
