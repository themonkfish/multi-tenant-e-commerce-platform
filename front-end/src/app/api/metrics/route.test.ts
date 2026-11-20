import { afterEach, describe, expect, it, vi } from "vitest";
import { resetObservabilityMetricsForTests } from "@/lib/server/observability";
import { GET } from "./route";

describe("GET /api/metrics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetObservabilityMetricsForTests();
  });

  it("requires metrics authentication", async () => {
    vi.stubEnv("OBSERVABILITY_METRICS_TOKEN", "metrics-test-token-123");
    const response = await GET(
      new Request("https://platform.example.com/api/metrics"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "unauthorized",
      requestId: expect.any(String),
    });
  });

  it("returns Prometheus text for a valid bearer token", async () => {
    vi.stubEnv("OBSERVABILITY_METRICS_TOKEN", "metrics-test-token-123");
    const response = await GET(
      new Request("https://platform.example.com/api/metrics", {
        headers: { authorization: "Bearer metrics-test-token-123" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("ecommerce_process_uptime_seconds");
    expect(body).toContain("ecommerce_event_total");
  });

  it("returns 503 when metrics authentication is not configured", async () => {
    vi.stubEnv("OBSERVABILITY_METRICS_TOKEN", "");
    const response = await GET(
      new Request("https://platform.example.com/api/metrics"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "metrics_not_configured",
      requestId: expect.any(String),
    });
  });
});
