"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  RestHealthCheckResultSchema,
  TenantRestConnectionInputSchema,
  TenantRestConnectionViewSchema,
  type RestHealthCheckResult,
} from "@/core/domain/tenant-config";

export function TenantRestConnectionForm({
  initialConnection,
}: {
  initialConnection: {
    baseUrl: string;
    apiVersion: string;
    apiKeyConfigured: boolean;
  };
}) {
  const t = useTranslations("TenantSetup");
  const [baseUrl, setBaseUrl] = useState(initialConnection.baseUrl);
  const [apiVersion, setApiVersion] = useState(initialConnection.apiVersion);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(
    initialConnection.apiKeyConfigured,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<RestHealthCheckResult | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = TenantRestConnectionInputSchema.safeParse({
      baseUrl,
      apiVersion,
      ...(apiKey ? { apiKey } : {}),
    });
    if (!input.success) {
      setError(t("invalidConnectionInput"));
      setNotice("");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setHealth(null);
    try {
      const response = await fetch("/api/tenant/data-connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? t("tooManyChanges")
            : code === "unsafe_url"
              ? t("unsafeUrl")
              : code === "api_key_required"
                ? t("apiKeyRequired")
                : t("connectionSaveFailed"),
        );
        return;
      }
      const connection =
        typeof body === "object" && body !== null && "connection" in body
          ? TenantRestConnectionViewSchema.safeParse(body.connection)
          : null;
      if (!connection?.success) {
        setError(t("invalidConnectionResponse"));
        return;
      }
      setBaseUrl(connection.data.baseUrl);
      setApiVersion(connection.data.apiVersion);
      setApiKeyConfigured(connection.data.apiKeyConfigured);
      setApiKey("");
      setNotice(
        typeof body === "object" &&
          body !== null &&
          "warning" in body &&
          body.warning === "previous_credential_cleanup_failed"
          ? t("credentialCleanupWarning")
          : t("connectionSaved"),
      );
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError("");
    setNotice("");
    setHealth(null);
    try {
      const response = await fetch("/api/tenant/data-connection/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? t("tooManyTests")
            : code === "connection_not_configured"
              ? t("saveBeforeTest")
              : t("connectionTestFailed"),
        );
        return;
      }
      const result =
        typeof body === "object" && body !== null && "result" in body
          ? RestHealthCheckResultSchema.safeParse(body.result)
          : null;
      if (!result?.success) {
        setError(t("invalidHealthResponse"));
        return;
      }
      setHealth(result.data);
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <form className="grid gap-5 sm:grid-cols-2" onSubmit={save}>
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          {t("backendBaseUrl")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com"
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("apiVersion")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="apiVersion"
            value={apiVersion}
            onChange={(event) => setApiVersion(event.target.value)}
            placeholder="v1"
            maxLength={32}
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("apiKey")}
          {apiKeyConfigured ? ` ${t("apiKeyKeepCurrent")}` : ""}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="apiKey"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            maxLength={2048}
            required={!apiKeyConfigured}
          />
        </label>
        <p className="text-sm text-slate-600 sm:col-span-2">
          {t.rich("restSecurityHelp", {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button
            className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? t("saving") : t("saveConnection")}
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-60"
            disabled={busy || !apiKeyConfigured}
            onClick={testConnection}
            type="button"
          >
            {busy ? t("checking") : t("testConnection")}
          </button>
        </div>
      </form>
      {(error || notice) && (
        <p
          className={`text-sm ${error ? "text-red-700" : "text-green-700"}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
      {health && (
        <div
          className={`rounded-md border p-4 text-sm ${health.status === "healthy" ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}
          role="status"
        >
          <p className="font-semibold">
            {t("healthStatus", {
              status: health.status,
              latencyMs: health.latencyMs,
            })}
          </p>
          {health.schemaVersion && (
            <p className="mt-1">
              {t("schemaVersion", { version: health.schemaVersion })}
            </p>
          )}
          {health.missing.length > 0 && (
            <p className="mt-1">
              {t("componentsToCheck", {
                components: health.missing.join(", "),
              })}
            </p>
          )}
          {health.error && (
            <p className="mt-1">
              {t("checkResult", {
                result: health.error.replaceAll("_", " "),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
