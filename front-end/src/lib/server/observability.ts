import "server-only";
import { randomUUID } from "node:crypto";

export type ObservabilityContext = {
  hostId?: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
};

function normalizeRequestId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : null;
}

export function getRequestCorrelationId(request: Request): string {
  return (
    normalizeRequestId(request.headers.get("x-request-id")) ??
    normalizeRequestId(request.headers.get("x-correlation-id")) ??
    randomUUID()
  );
}

function errorFields(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 500),
    };
  }
  return { errorMessage: String(error).slice(0, 500) };
}

const startedAt = Date.now();
const counters = new Map<string, number>();

export function recordObservabilityMetric(name: string, increment = 1) {
  if (!name || !Number.isFinite(increment) || increment < 0) return;
  counters.set(name, (counters.get(name) ?? 0) + increment);
}

export function getObservabilityMetrics() {
  return {
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    counters: Object.fromEntries(
      [...counters.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

export function resetObservabilityMetricsForTests() {
  counters.clear();
}

export function formatPrometheusMetrics(): string {
  const metrics = getObservabilityMetrics();
  const lines = [
    "# HELP ecommerce_process_uptime_seconds Process uptime in seconds.",
    "# TYPE ecommerce_process_uptime_seconds gauge",
    `ecommerce_process_uptime_seconds ${metrics.uptimeSeconds}`,
  ];
  lines.push(
    "# HELP ecommerce_event_total Application event counter.",
    "# TYPE ecommerce_event_total counter",
  );
  for (const [name, value] of Object.entries(metrics.counters)) {
    const escapedName = name.replace(/[^A-Za-z0-9_:]/g, "_");
    lines.push(`ecommerce_event_total{event="${escapedName}"} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function createStructuredLogger(context: ObservabilityContext = {}) {
  const base = {
    service: "multi-tenant-e-commerce",
    environment: process.env.NODE_ENV ?? "development",
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.hostId ? { hostId: context.hostId } : {}),
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
  };

  return {
    info(event: string, fields: Record<string, unknown> = {}) {
      console.info(
        JSON.stringify({
          level: "info",
          event,
          timestamp: new Date().toISOString(),
          ...base,
          ...fields,
        }),
      );
    },
    warn(event: string, fields: Record<string, unknown> = {}) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event,
          timestamp: new Date().toISOString(),
          ...base,
          ...fields,
        }),
      );
    },
    error(event: string, error: unknown, fields: Record<string, unknown> = {}) {
      console.error(
        JSON.stringify({
          level: "error",
          event,
          timestamp: new Date().toISOString(),
          ...base,
          ...errorFields(error),
          ...fields,
        }),
      );
    },
  };
}
