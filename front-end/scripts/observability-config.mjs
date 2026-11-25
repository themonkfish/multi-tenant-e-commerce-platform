import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validatePrometheusAlertExpression(expression) {
  if (typeof expression !== "string" || expression.trim().length === 0) {
    throw new Error("Prometheus alert expression is blank");
  }
  if (expression.length > 8_192) {
    throw new Error("Prometheus alert expression is too long");
  }
  if (/^["']|[{}]\s*$/.test(expression.trim())) {
    throw new Error("Prometheus alert expression is invalid");
  }
  return true;
}

function rejectPlaceholders(value) {
  if (/ecommerce\.example\.com|alerts\.example\.com/i.test(value)) {
    throw new Error(
      "Observability configuration contains example.com placeholders",
    );
  }
  return true;
}

export function validateObservabilityConfig({
  prometheus,
  alerts,
  alertmanager = "",
  grafana = "",
}) {
  for (const [name, value] of Object.entries({
    prometheus,
    alerts,
    alertmanager,
    grafana,
  })) {
    if (typeof value !== "string") continue;
    if (name === "prometheus" && !value.includes("scrape_configs")) {
      throw new Error("Prometheus configuration is invalid");
    }
    if (
      name === "alerts" &&
      /^\s*expr:\s*(?:#.*)?$/gm.test(value)
    ) {
      throw new Error("Prometheus alert configuration is invalid");
    }
    if (name === "grafana" && value.includes('"panels"') && !value.trim()) {
      throw new Error("Grafana configuration is invalid");
    }
    rejectPlaceholders(value);
  }

  if (!prometheus || !prometheus.trim()) {
    throw new Error("Prometheus configuration is missing");
  }
  if (!alerts || !alerts.trim()) {
    throw new Error("Prometheus alert configuration is missing");
  }
  const expressions = [
    ...alerts.matchAll(/^\s*expr:\s*(.+)$/gm),
  ].map((match) => match[1].trim());
  for (const expression of expressions) {
    validatePrometheusAlertExpression(expression);
  }
  if (alerts.includes("expr:") && expressions.length === 0) {
    throw new Error("Prometheus alert configuration is invalid");
  }

  if (grafana) {
    let dashboard;
    try {
      dashboard = JSON.parse(grafana);
    } catch {
      throw new Error("Grafana dashboard JSON is invalid");
    }
    if (!Array.isArray(dashboard.panels)) {
      throw new Error("Grafana dashboard is invalid");
    }
  }

  return { verified: true, placeholderCount: 0 };
}

export async function readObservabilityConfigSet(directory) {
  const root = resolve(directory);
  const names = [
    "prometheus.yml",
    "alerts.yml",
    "alertmanager.yml",
    "grafana-dashboard.json",
  ];
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: await readFile(resolve(root, name), "utf8"),
    })),
  );
  validateObservabilityConfig({
    prometheus: files.find((file) => file.name === "prometheus.yml")?.content ?? "",
    alerts: files.find((file) => file.name === "alerts.yml")?.content ?? "",
    alertmanager:
      files.find((file) => file.name === "alertmanager.yml")?.content ?? "",
    grafana:
      files.find((file) => file.name === "grafana-dashboard.json")?.content ??
      "",
  });
  return { verified: true, files: names };
}

function usage() {
  return "Usage:\n  node scripts/observability-config.mjs validate [directory]";
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const [command, directoryArgument] = process.argv.slice(2);
  try {
    if (command !== "validate") throw new Error(usage());
    const result = await readObservabilityConfigSet(
      directoryArgument ?? resolve(process.cwd(), "observability"),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
