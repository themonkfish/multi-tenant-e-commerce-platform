import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ProductReviewInputSchema,
  ProductReviewSchema,
} from "@/core/domain/product-review";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";
import { getRequestDomainScope } from "@/lib/server/request-scope";

type ReviewRouteProps = {
  params: Promise<{ productId: string }>;
};

export async function GET(_request: Request, { params }: ReviewRouteProps) {
  const scope = await getRequestDomainScope();
  if (scope?.kind !== "tenant") {
    return NextResponse.json({ error: "tenant_unavailable" }, { status: 404 });
  }
  const { productId } = await params;
  const reviews = await getPlatformStore().listProductReviews(
    scope.tenant.id,
    productId,
  );
  return NextResponse.json({ reviews });
}

export async function POST(request: Request, { params }: ReviewRouteProps) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const parsed = ProductReviewInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { productId } = await params;
  if (parsed.data.productId !== productId) {
    return NextResponse.json({ error: "product_mismatch" }, { status: 400 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "product-review-create", session.userId),
    limit: 10,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const customerOrders = await store.listCustomerOrders(
    session.scope.id,
    session.userId,
  );
  const hasPaidPurchase = customerOrders.some(
    (order) =>
      order.paymentStatus === "paid" &&
      order.items.some((item) => item.productId === productId),
  );
  if (!hasPaidPurchase) {
    return NextResponse.json({ error: "purchase_required" }, { status: 403 });
  }

  const review = ProductReviewSchema.parse({
    id: randomUUID(),
    tenantId: session.scope.id,
    productId,
    customerId: session.userId,
    rating: parsed.data.rating,
    title: parsed.data.title,
    body: parsed.data.body,
    createdAt: new Date().toISOString(),
  });
  try {
    const saved = await store.createProductReview(review);
    await store.appendAuditEvent({
      id: randomUUID(),
      actorId: session.userId,
      scope: session.scope,
      action: "customer.product_review.created",
      resourceType: "product_review",
      resourceId: saved.id,
      createdAt: saved.createdAt,
    });
    return NextResponse.json({ review: saved }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "A review already exists for this product"
    ) {
      return NextResponse.json({ error: "review_exists" }, { status: 409 });
    }
    throw error;
  }
}
