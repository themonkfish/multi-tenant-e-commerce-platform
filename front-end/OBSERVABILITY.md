# External observability

Set `OBSERVABILITY_METRICS_TOKEN` to a long random value and expose the
application health endpoint and bearer-protected metrics endpoint:

- `GET /api/health`
- `GET /api/metrics`

Use HTTPS in production and store the metrics bearer token in your monitoring
provider's secret manager. Never expose the token or `/api/metrics` response in
source control, logs, screenshots, or chat.

## Prometheus

The example files in `observability/` demonstrate a Prometheus scrape job and
alert rules. Replace `ecommerce.example.com` with the real public hostname.
Mount the metrics token at `/etc/prometheus/ecommerce-metrics-token`, then load
`observability/alerts.yml` as a Prometheus rule file.

Prometheus alert annotations should point to this runbook and to the alert
receiver used by your team.

## Grafana

Import `observability/grafana-dashboard.json` and select a Prometheus data
source named `Prometheus`. The dashboard covers uptime, metrics scraping,
Stripe events and sync failures, carrier events and sync failures, and
unauthorized/rate-limited activity.

The metrics endpoint also exposes `ecommerce_scoped_event_total` with sanitized
`host_id` and `tenant_id` labels for tenant-filtered operational views. Use
Alertmanager configuration from `observability/alertmanager.yml` and replace
the example webhook receiver before production use.

The metrics are process-local counters. With multiple application processes,
scrape every replica and use Prometheus aggregation. Counters reset on process
restart; rates should therefore use `increase()` over a bounded window.

## Runbooks

- **Metrics target down:** verify DNS/TLS, application process health,
  `/api/health`, and `OBSERVABILITY_METRICS_TOKEN`.
- **Webhook sync failures:** inspect structured webhook logs using the
  `requestId`, `tenantId`, and `orderId` fields; verify Tenant backend
  connectivity and credentials.
- **Signature rejections:** confirm provider webhook secrets, payload replay,
  and clock/settings synchronization; rotate a compromised secret if needed.
- **Unauthorized scrapes:** verify the monitoring secret and ensure it was not
  copied to application logs or public configuration.
