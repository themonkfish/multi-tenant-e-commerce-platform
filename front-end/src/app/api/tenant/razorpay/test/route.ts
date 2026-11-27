import { NextResponse } from "next/server";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore, getSecretVault } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import { testRazorpayConnection } from "@/lib/server/razorpay-payments";

export async function POST(request: Request) {
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
  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(
      request,
      "tenant-razorpay-provider-test",
      session.userId,
    ),
    limit: 5,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const settings = await store.getTenantStoreSettings(
    session.scope.id,
    session.scope.hostId,
    "",
  );
  const config = settings.payments.razorpayConfig;
  if (!config) {
    return NextResponse.json(
      { result: { status: "unhealthy", latencyMs: 0 } },
      { status: 409 },
    );
  }
  try {
    const secret = await getSecretVault().getSecret(config.credentialsRef);
    const parsed = JSON.parse(secret) as {
      keyId?: string;
      keySecret?: string;
      webhookSecret?: string;
    };
    if (
      !parsed.keyId ||
      !parsed.keySecret ||
      !parsed.webhookSecret
    ) {
      return NextResponse.json(
        { result: { status: "unhealthy", latencyMs: 0 } },
        { status: 502 },
      );
    }
    const result = await testRazorpayConnection({
      keyId: parsed.keyId,
      keySecret: parsed.keySecret,
      webhookSecret: parsed.webhookSecret,
    });
    return NextResponse.json(
      { result },
      { status: result.status === "healthy" ? 200 : 502 },
    );
  } catch {
    return NextResponse.json(
      { result: { status: "unhealthy", latencyMs: 0 } },
      { status: 502 },
    );
  }
}
