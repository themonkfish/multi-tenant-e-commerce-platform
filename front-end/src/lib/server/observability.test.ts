import { describe, expect, it, vi } from "vitest";
import {
  createStructuredLogger,
  getRequestCorrelationId,
} from "./observability";

describe("observability", () => {
  it("reuses a valid request correlation ID", () => {
    const request = new Request("https://store.example.com/api/health", {
      headers: { "x-request-id": "request-123_abc" },
    });
    expect(getRequestCorrelationId(request)).toBe("request-123_abc");
  });

  it("generates a correlation ID for an invalid header", () => {
    const request = new Request("https://store.example.com/api/health", {
      headers: { "x-request-id": "bad value with spaces" },
    });
    expect(getRequestCorrelationId(request)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("writes JSON error records with tenant scope", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createStructuredLogger({
      tenantId: "tenant-1",
      hostId: "host-1",
      requestId: "request-1",
    }).error("tenant.operation_failed", new Error("backend unavailable"), {
      orderId: "ORD-1",
    });
    const record = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      level: "error",
      event: "tenant.operation_failed",
      tenantId: "tenant-1",
      hostId: "host-1",
      requestId: "request-1",
      errorName: "Error",
      errorMessage: "backend unavailable",
      orderId: "ORD-1",
    });
    spy.mockRestore();
  });
});
