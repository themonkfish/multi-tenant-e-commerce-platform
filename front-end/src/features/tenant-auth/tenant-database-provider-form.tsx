"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("TenantDatabase");
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
        setError(t("saveFailed"));
        return;
      }
      setConnection(result.connection);
      setServiceKey("");
      setConnectionString("");
      setNotice(
        result.warning === "previous_credential_cleanup_failed"
          ? t("credentialCleanupWarning")
          : t("connectionSaved"),
      );
    } catch {
      setError(t("saveFailed"));
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
        setError(t("testFailed"));
        return;
      }
      setTestResult(payload.result);
      if (payload.result.status === "unhealthy") {
        setError(
          connection?.type === "supabase"
            ? t("supabaseTestUnhealthy")
            : t("mongodbTestUnhealthy"),
        );
      }
    } catch {
      setError(t("testFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function initializeSchema() {
    if (testResult?.schemaStatus === "upgrade_required") {
      setError(t("schemaTooNew"));
      return;
    }
    if (
      testResult?.schemaStatus === "upgrade_available" &&
      !window.confirm(t("confirmSchemaUpgrade"))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/data-provider/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmUpgrade: testResult?.schemaStatus === "upgrade_available",
        }),
      });
      const payload = (await response.json()) as {
        schemaVersion?: number;
        status?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(
          payload.error === "schema_upgrade_confirmation_required"
            ? t("confirmSchemaUpgradeRequired")
            : payload.error === "schema_upgrade_required"
              ? t("schemaTooNew")
              : connection?.type === "supabase"
                ? t("supabaseInitializeFailed")
                : t("mongodbInitializeFailed"),
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
        t("schemaInitialized", {
          version: payload.schemaVersion ?? t("unknownVersion"),
        }),
      );
    } catch {
      setError(t("initializeFailed"));
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
        setError(t("removeFailed"));
        return;
      }
      setConnection(null);
      setTestResult(null);
      setNotice(
        payload.warning === "credential_cleanup_failed"
          ? t("removeCredentialWarning")
          : t("providerRemoved"),
      );
    } catch {
      setError(t("removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <label className="space-y-1 text-sm font-medium">
          {t("databaseProvider")}
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
            <option value="supabase">{t("supabase")}</option>
            <option value="mongodb">{t("mongodb")}</option>
          </select>
        </label>
        {provider === "supabase" ? (
          <>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              {t("supabaseProjectUrl")}
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
              {t("serviceRoleKey")}
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setServiceKey(event.target.value)}
                placeholder={
                  connection?.type === "supabase"
                    ? t("keepCredential")
                    : t("enterServiceRoleKey")
                }
                type="password"
                value={serviceKey}
              />
            </label>
          </>
        ) : (
          <>
            <label className="space-y-1 text-sm font-medium">
              {t("databaseName")}
              <input
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setDbName(event.target.value)}
                required
                value={dbName}
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              {t("mongodbConnectionString")}
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setConnectionString(event.target.value)}
                placeholder={
                  connection?.type === "mongodb"
                    ? t("keepCredential")
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
            {t("saveConnection")}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy || !connection}
            onClick={testConnection}
            type="button"
          >
            {t("testConnection")}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={
              busy ||
              !connection ||
              testResult?.schemaStatus === "upgrade_required"
            }
            onClick={initializeSchema}
            type="button"
          >
            {t("initializeSchema")}
          </button>
          <button
            className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
            disabled={busy || !connection}
            onClick={disconnect}
            type="button"
          >
            {t("removeProvider")}
          </button>
        </div>
      </form>
      {connection ? (
        <p className="text-sm text-slate-600">
          {t("activeProvider", { provider: connection.type })}
        </p>
      ) : (
        <p className="text-sm text-slate-600">{t("noProvider")}</p>
      )}
      {provider === "supabase" ? (
        <p className="text-sm text-slate-600">{t("supabaseHelp")}</p>
      ) : (
        <p className="text-sm text-slate-600">{t("mongodbHelp")}</p>
      )}
      {testResult ? (
        <p className="text-sm text-slate-700">
          {t("testStatus", {
            status: testResult.status,
            schemaStatus: testResult.schemaStatus,
          })}
          {testResult.schemaVersion === null
            ? ""
            : ` ${t("version", { version: testResult.schemaVersion })}`}
          {testResult.schemaStatus === "upgrade_available" ||
          testResult.schemaStatus === "upgrade_required"
            ? ` — ${t("upgradeRequired")}`
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
