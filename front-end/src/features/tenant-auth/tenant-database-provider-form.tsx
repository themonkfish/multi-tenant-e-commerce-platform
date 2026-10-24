"use client";

import { useState, type FormEvent } from "react";
import type { TenantDatabaseConnectionViewSchema } from "@/core/domain/tenant-config";
import { TENANT_CATALOG_SCHEMA_VERSION } from "@/adapters/data/database/tenant-database-adapter";
import type { z } from "zod";

type ConnectionView = z.infer<typeof TenantDatabaseConnectionViewSchema>;

type ProviderTestResult = {
  status: "healthy" | "unhealthy";
  schemaVersion: number | null;
  currentSchemaVersion: number;
  schemaStatus:
    | "not_initialized"
    | "current"
    | "upgrade_available"
    | "upgrade_required"
    | "unavailable";
};

export function TenantDatabaseProviderForm({
  initialConnection,
}: {
  initialConnection: ConnectionView | null;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [provider, setProvider] = useState<"supabase" | "mongodb">(
    initialConnection?.type === "mongodb" ? "mongodb" : "supabase",
  );
  const [projectUrl, setProjectUrl] = useState(
    initialConnection?.type === "supabase" ? initialConnection.projectUrl : "",
  );
  const [serviceKey, setServiceKey] = useState("");
  const [dbName, setDbName] = useState(
    initialConnection?.type === "mongodb" ? initialConnection.dbName : "",
  );
  const [connectionString, setConnectionString] = useState("");
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setTestResult(null);
    setBusy(true);
    try {
      const body =
        provider === "supabase"
          ? { type: provider, projectUrl, serviceKey: serviceKey || undefined }
          : {
              type: provider,
              dbName,
              connectionString: connectionString || undefined,
            };
      const response = await fetch("/api/tenant/data-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        connection?: ConnectionView;
        error?: string;
        warning?: string;
      };
      if (!response.ok || !result.connection) {
        setError(result.error ?? "Could not save the database connection.");
        return;
      }
      setConnection(result.connection);
      setServiceKey("");
      setConnectionString("");
      setNotice(
        result.warning === "previous_credential_cleanup_failed"
          ? "Database settings saved, but the previous credential could not be removed. Contact a platform administrator."
          : "Database connection settings saved. Credentials are write-only.",
      );
    } catch {
      setError("Could not save the database connection.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/data-provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as {
        result?: ProviderTestResult;
        error?: string;
      };
      if (!payload.result) {
        setError(payload.error ?? "Database connection test failed.");
        return;
      }
      setTestResult(payload.result);
      if (payload.result.status === "unhealthy") {
        setError(
          connection?.type === "supabase"
            ? "Connection failed. Apply the Supabase reference SQL to the tenant project, then test again."
            : "Could not connect to MongoDB Atlas. Check the URI, database user, and Atlas network access list.",
        );
      }
    } catch {
      setError("Database connection test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function initializeSchema() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/data-provider/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as {
        schemaVersion?: number;
        status?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(
          payload.error === "schema_upgrade_required"
            ? "The database schema is newer than this platform supports."
            : connection?.type === "supabase"
              ? "Initialization failed. Apply the Supabase reference SQL to the tenant project first."
              : "MongoDB schema initialization failed. Verify the URI permissions and Atlas network access list.",
        );
        return;
      }
      setTestResult({
        status: "healthy",
        schemaVersion: payload.schemaVersion ?? null,
        currentSchemaVersion: TENANT_CATALOG_SCHEMA_VERSION,
        schemaStatus: "current",
      });
      setNotice(
        `Tenant catalog schema initialized (version ${payload.schemaVersion ?? "unknown"}).`,
      );
    } catch {
      setError("Database schema initialization failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/data-provider", {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        error?: string;
        warning?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Could not remove the database connection.");
        return;
      }
      setConnection(null);
      setTestResult(null);
      setNotice(
        payload.warning === "credential_cleanup_failed"
          ? "Database provider removed, but its stored credential could not be deleted. Contact a platform administrator."
          : "Database provider removed. The configured REST backend can be used again.",
      );
    } catch {
      setError("Could not remove the database connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <label className="space-y-1 text-sm font-medium">
          Database provider
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={provider}
            onChange={(event) => {
              if (
                event.target.value === "supabase" ||
                event.target.value === "mongodb"
              ) {
                setProvider(event.target.value);
              }
              setTestResult(null);
            }}
          >
            <option value="supabase">Supabase</option>
            <option value="mongodb">MongoDB Atlas</option>
          </select>
        </label>
        {provider === "supabase" ? (
          <>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Tenant Supabase project URL
              <input
                autoComplete="url"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setProjectUrl(event.target.value)}
                required
                type="url"
                value={projectUrl}
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Service-role key
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setServiceKey(event.target.value)}
                placeholder={
                  connection?.type === "supabase"
                    ? "Leave blank to keep the saved credential"
                    : "Enter the tenant project service-role key"
                }
                type="password"
                value={serviceKey}
              />
            </label>
          </>
        ) : (
          <>
            <label className="space-y-1 text-sm font-medium">
              Database name
              <input
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setDbName(event.target.value)}
                required
                value={dbName}
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              MongoDB Atlas SRV connection string
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setConnectionString(event.target.value)}
                placeholder={
                  connection?.type === "mongodb"
                    ? "Leave blank to keep the saved credential"
                    : "mongodb+srv://..."
                }
                type="password"
                value={connectionString}
              />
            </label>
          </>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Save database connection
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy || !connection}
            onClick={testConnection}
            type="button"
          >
            Test connection
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy || !connection}
            onClick={initializeSchema}
            type="button"
          >
            Initialize schema
          </button>
          <button
            className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
            disabled={busy || !connection}
            onClick={disconnect}
            type="button"
          >
            Remove database provider
          </button>
        </div>
      </form>
      {connection ? (
        <p className="text-sm text-slate-600">
          Active database provider:{" "}
          <span className="font-medium">{connection.type}</span>. Database
          credentials are encrypted and are never returned to the browser.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          No database provider is configured. If a REST backend is configured,
          it remains active.
        </p>
      )}
      {provider === "supabase" ? (
        <p className="text-sm text-slate-600">
          Supabase requires the tenant project service-role key and the SQL
          reference schema applied in that tenant project before initialization.
          Never use the platform project credentials here.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          MongoDB connections are limited to TLS-protected MongoDB Atlas SRV
          endpoints. Allow this application&apos;s outbound IP in the Atlas
          network access list.
        </p>
      )}
      {testResult ? (
        <p className="text-sm text-slate-700">
          Test status: {testResult.status}; schema: {testResult.schemaStatus}
          {testResult.schemaVersion === null
            ? ""
            : ` (version ${testResult.schemaVersion})`}
          {testResult.schemaStatus === "upgrade_available" ||
          testResult.schemaStatus === "upgrade_required"
            ? " — a schema upgrade is required."
            : ""}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
