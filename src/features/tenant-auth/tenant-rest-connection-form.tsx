"use client";

import { useState, type FormEvent } from "react";
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
      setError("Enter a valid HTTPS backend URL, API version, and API key.");
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
            ? "Too many changes. Wait before trying again."
            : code === "unsafe_url"
              ? "Use an HTTPS public backend hostname without a path or query."
              : code === "api_key_required"
                ? "Enter an API key to configure the connection."
                : "Connection settings could not be saved.",
        );
        return;
      }
      const connection =
        typeof body === "object" && body !== null && "connection" in body
          ? TenantRestConnectionViewSchema.safeParse(body.connection)
          : null;
      if (!connection?.success) {
        setError("The server returned invalid connection settings.");
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
          ? "Settings were saved, but the previous encrypted API key could not be removed."
          : "REST connection settings saved. The API key is stored securely and cannot be viewed here.",
      );
    } catch {
      setError("The request could not reach the server. Please try again.");
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
            ? "Too many connection tests. Wait before trying again."
            : code === "connection_not_configured"
              ? "Save the backend URL and API key before testing."
              : "The backend connection test could not be completed.",
        );
        return;
      }
      const result =
        typeof body === "object" && body !== null && "result" in body
          ? RestHealthCheckResultSchema.safeParse(body.result)
          : null;
      if (!result?.success) {
        setError("The server returned an invalid health-check result.");
        return;
      }
      setHealth(result.data);
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <form className="grid gap-5 sm:grid-cols-2" onSubmit={save}>
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          HTTPS backend base URL
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
          API version
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
          API key {apiKeyConfigured ? "(leave blank to keep current key)" : ""}
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
          Authentication uses the <code>X-API-Key</code> request header. Only
          HTTPS on the standard port is supported. The key is write-only and
          encrypted at rest.
        </p>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button
            className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? "Saving…" : "Save backend connection"}
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-60"
            disabled={busy || !apiKeyConfigured}
            onClick={testConnection}
            type="button"
          >
            {busy ? "Checking…" : "Test saved connection"}
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
            Backend {health.status} in {health.latencyMs} ms
          </p>
          {health.schemaVersion && (
            <p className="mt-1">Schema version: {health.schemaVersion}</p>
          )}
          {health.missing.length > 0 && (
            <p className="mt-1">
              Components to check: {health.missing.join(", ")}
            </p>
          )}
          {health.error && (
            <p className="mt-1">
              Check result: {health.error.replaceAll("_", " ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
