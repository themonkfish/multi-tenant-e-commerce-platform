import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  validateObservabilityConfig,
  validatePrometheusAlertExpression,
} from "./observability-config.mjs";

test("validates and rejects example observability placeholders", () => {
  const prometheus = `scrape_configs:
  - job_name: ecommerce
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/ecommerce-metrics-token
`;
  const alerts = `groups:
  - name: ecommerce
    rules:
      - alert: EcommerceDown
        expr: up == 0
`;
  assert.deepEqual(
    validateObservabilityConfig({ prometheus, alerts }),
    { verified: true, placeholderCount: 0 },
  );
  assert.throws(
    () =>
      validateObservabilityConfig({
        prometheus: prometheus.replace(
          "credentials_file: /run/secrets/ecommerce-metrics-token",
          "credentials_file: /etc/prometheus/ecommerce-metrics-token",
        ),
        alerts: "groups:\n  - name: ecommerce\n    rules:\n      - alert: EcommerceDown\n        expr:\n",
      }),
    /invalid/i,
  );
});

test("rejects placeholder targets and receivers", () => {
  assert.throws(
    () =>
      validateObservabilityConfig({
        prometheus:
          "scrape_configs:\n  - job_name: ecommerce\n  static_configs:\n  - targets:\n      - ecommerce.example.com\n",
        alerts: "groups: []",
        alertmanager:
          "receivers:\n  - name: ecommerce-default\n    webhook_configs:\n      - url: https://alerts.example.com/ecommerce\n",
      }),
    /example/i,
  );
});

test("accepts valid alert expressions and rejects blank expressions", () => {
  assert.equal(
    validatePrometheusAlertExpression("increase(ecommerce_event_total[10m]) > 5"),
    true,
  );
  assert.throws(
    () => validatePrometheusAlertExpression(""),
    /blank|expression/i,
  );
});

test("reads an observability config set from disk", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "observability-config-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "prometheus.yml"),
    "scrape_configs:\n  - job_name: ecommerce\n",
  );
  await writeFile(join(directory, "alerts.yml"), "groups: []\n");
  await writeFile(join(directory, "alertmanager.yml"), "route:\n  receiver: ecommerce\n");
  await writeFile(
    join(directory, "grafana-dashboard.json"),
    JSON.stringify({ title: "Ecommerce", panels: [] }),
  );

  const { readObservabilityConfigSet } =
    await import("./observability-config.mjs");
  const result = await readObservabilityConfigSet(directory);
  assert.equal(result.files.length, 4);
});
