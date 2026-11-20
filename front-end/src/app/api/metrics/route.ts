import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server/env";
import {
  formatPrometheusMetrics,
  getRequestCorrelationId,
  recordObservabilityMetric,
} from "@/lib/server/observability";

export async function GET(request: Request) {
  const requestId = getRequestCorrelationId(request);
  recordObservabilityMetric("metrics.scrape.received");

  let token: string;
  try {
    token = getServerEnv().OBSERVABILITY_METRICS_TOKEN ?? "";
  } catch {
    return NextResponse.json(
      { error: "metrics_not_configured", requestId },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "metrics_not_configured", requestId },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const valid =
    supplied.length > 0 &&
    supplied.length === token.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  if (!valid) {
    recordObservabilityMetric("metrics.scrape.unauthorized");
    return NextResponse.json(
      { error: "unauthorized", requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  recordObservabilityMetric("metrics.scrape.success");
  return new NextResponse(formatPrometheusMetrics(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
