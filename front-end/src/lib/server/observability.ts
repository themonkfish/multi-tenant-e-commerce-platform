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
const scopedCounters = new Map<string, number>();

export function recordObservabilityMetric(name: string, increment = 1) {
  if (!name || !Number.isFinite(increment) || increment < 0) return;
  counters.set(name, (counters.get(name) ?? 0) + increment);
}

export function recordScopedObservabilityMetric(
  name: string,
  context: ObservabilityContext,
  increment = 1,
) {
  recordObservabilityMetric(name, increment);
  if (!name || !Number.isFinite(increment) || increment < 0) return;
  const tenantId = context.tenantId?.replace(/[^A-Za-z0-9_-]/g, "_");
  const hostId = context.hostId?.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!tenantId && !hostId) return;
  const key = JSON.stringify({ name, tenantId, hostId });
  scopedCounters.set(key, (scopedCounters.get(key) ?? 0) + increment);
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
  scopedCounters.clear();
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
  lines.push(
    "# HELP ecommerce_scoped_event_total Application event counter with host and tenant labels.",
    "# TYPE ecommerce_scoped_event_total counter",
  );
  for (const [serialized, value] of [...scopedCounters.entries()].sort()) {
    const { name, tenantId, hostId } = JSON.parse(serialized) as {
      name: string;
      tenantId?: string;
      hostId?: string;
    };
    const labels = [
      `event="${name.replace(/[^A-Za-z0-9_:]/g, "_")}"`,
      ...(hostId ? [`host_id="${hostId}"`] : []),
      ...(tenantId ? [`tenant_id="${tenantId}"`] : []),
    ];
    lines.push(`ecommerce_scoped_event_total{${labels.join(",")}} ${value}`);
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
