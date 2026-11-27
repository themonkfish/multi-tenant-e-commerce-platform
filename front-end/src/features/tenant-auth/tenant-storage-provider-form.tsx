"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  TenantStorageConnectionViewSchema,
  type TenantStorageConnectionInputSchema,
} from "@/core/domain/tenant-config";
import { z } from "zod";

type StorageConnection = z.infer<typeof TenantStorageConnectionViewSchema>;

export function TenantStorageProviderForm({
  initialConnection,
}: {
  initialConnection: StorageConnection | null;
}) {
  const t = useTranslations("TenantStorage");
  const [connection, setConnection] = useState(initialConnection);
  const [provider, setProvider] = useState<
    "s3" | "supabase" | "gcs" | "azure" | "cloudinary" | "gdrive"
  >(
    initialConnection?.type === "supabase"
      ? "supabase"
      : initialConnection?.type === "gcs"
        ? "gcs"
        : initialConnection?.type === "azure"
          ? "azure"
          : initialConnection?.type === "cloudinary"
            ? "cloudinary"
            : initialConnection?.type === "gdrive"
              ? "gdrive"
              : "s3",
  );
  const [endpoint, setEndpoint] = useState(
    initialConnection?.type === "s3" ? (initialConnection.endpoint ?? "") : "",
  );
  const [region, setRegion] = useState(
    initialConnection?.type === "s3" ? initialConnection.region : "",
  );
  const [bucket, setBucket] = useState(
    initialConnection?.type === "s3" ||
      initialConnection?.type === "supabase" ||
      initialConnection?.type === "gcs"
      ? initialConnection.bucket
      : "",
  );
  const [projectUrl, setProjectUrl] = useState(
    initialConnection?.type === "supabase" ? initialConnection.projectUrl : "",
  );
  const [publicBaseUrl, setPublicBaseUrl] = useState(
    initialConnection?.type === "s3" ||
      initialConnection?.type === "gcs" ||
      initialConnection?.type === "azure"
      ? initialConnection.publicBaseUrl
      : "",
  );
  const [pathStyle, setPathStyle] = useState(
    initialConnection?.type === "s3"
      ? (initialConnection.pathStyle ?? false)
      : false,
  );
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [azureAccountName, setAzureAccountName] = useState(
    initialConnection?.type === "azure"
      ? initialConnection.accountName
      : "",
  );
  const [azureContainer, setAzureContainer] = useState(
    initialConnection?.type === "azure"
      ? initialConnection.container
      : "",
  );
  const [azureAccountKey, setAzureAccountKey] = useState("");
  const [cloudinaryCloudName, setCloudinaryCloudName] = useState(
    initialConnection?.type === "cloudinary"
      ? initialConnection.cloudName
      : "",
  );
  const [cloudinaryApiKey, setCloudinaryApiKey] = useState("");
  const [cloudinaryApiSecret, setCloudinaryApiSecret] = useState("");
  const [gdriveFolderId, setGdriveFolderId] = useState(
    initialConnection?.type === "gdrive"
      ? initialConnection.folderId
      : "",
  );
  const [gdriveAccountEmail, setGdriveAccountEmail] = useState(
    initialConnection?.type === "gdrive"
      ? initialConnection.accountEmail
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (provider === "gdrive") {
        if (!gdriveFolderId.trim() || !gdriveAccountEmail.trim()) {
          setError(t("googleDriveFieldsRequired"));
          return;
        }
        const params = new URLSearchParams({
          folderId: gdriveFolderId.trim(),
          accountEmail: gdriveAccountEmail.trim(),
        });
        window.location.assign(
          `/api/tenant/storage/oauth/google-drive/start?${params.toString()}`,
        );
        return;
      }
      const body =
        provider === "supabase"
          ? {
              type: "supabase",
              projectUrl,
              bucket,
              ...(accessKeyId ? { serviceKey: accessKeyId } : {}),
            }
          : provider === "gcs"
            ? ({
                type: "gcs",
                bucket,
                publicBaseUrl,
                ...(serviceAccountJson
                  ? { serviceAccountJson }
                  : {}),
              } satisfies z.infer<typeof TenantStorageConnectionInputSchema>)
            : provider === "azure"
              ? ({
                  type: "azure",
                  accountName: azureAccountName,
                  container: azureContainer,
                  publicBaseUrl,
                  ...(azureAccountKey ? { accountKey: azureAccountKey } : {}),
                } satisfies z.infer<typeof TenantStorageConnectionInputSchema>)
            : provider === "cloudinary"
              ? ({
                  type: "cloudinary",
                  cloudName: cloudinaryCloudName,
                  ...(cloudinaryApiKey
                    ? { apiKey: cloudinaryApiKey }
                    : {}),
                  ...(cloudinaryApiSecret
                    ? { apiSecret: cloudinaryApiSecret }
                    : {}),
                } satisfies z.infer<typeof TenantStorageConnectionInputSchema>)
            : ({
                type: "s3",
                ...(endpoint ? { endpoint } : {}),
                region,
                bucket,
                publicBaseUrl,
                pathStyle,
                ...(accessKeyId ? { accessKeyId } : {}),
                ...(secretAccessKey ? { secretAccessKey } : {}),
                ...(sessionToken ? { sessionToken } : {}),
              } satisfies z.infer<typeof TenantStorageConnectionInputSchema>);
      const response = await fetch("/api/tenant/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof result === "object" && result !== null && "error" in result
            ? result.error
            : undefined;
        setError(
          code === "unsafe_storage_url"
            ? t("unsafeUrl")
            : code === "storage_credentials_required"
              ? t("credentialsRequired")
              : code === "rate_limited"
                ? t("tooManyChanges")
                : t("saveFailed"),
        );
        return;
      }
      const parsed =
        typeof result === "object" && result !== null && "connection" in result
          ? TenantStorageConnectionViewSchema.safeParse(result.connection)
          : null;
      if (!parsed?.success) {
        setError(t("invalidSettings"));
        return;
      }
      setConnection(parsed.data);
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setServiceAccountJson("");
      setAzureAccountKey("");
      setCloudinaryCloudName("");
      setCloudinaryApiKey("");
      setCloudinaryApiSecret("");
      setCloudinaryApiKey("");
      setCloudinaryApiSecret("");
      setNotice(t("settingsSaved"));
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
    try {
      const response = await fetch("/api/tenant/storage/test", {
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(t("testFailed"));
        return;
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("status" in body) ||
        (body.status !== "healthy" && body.status !== "unhealthy")
      ) {
        setError(t("invalidTestResult"));
        return;
      }
      setNotice(
        body.status === "healthy" ? t("bucketHealthy") : t("bucketUnhealthy"),
      );
    } catch {
      setError(t("testRequestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/storage", { method: "DELETE" });
      if (!response.ok) {
        setError(t("removeFailed"));
        return;
      }
      setConnection(null);
      setEndpoint("");
      setRegion("");
      setBucket("");
      setPublicBaseUrl("");
      setServiceAccountJson("");
      setAzureAccountName("");
      setAzureContainer("");
      setAzureAccountKey("");
      setPathStyle(false);
      setNotice(t("settingsRemoved"));
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-green-700" role="status">
          {notice}
        </p>
      )}
      {connection && (
        <p className="text-sm text-slate-600">
          {connection.type === "s3"
            ? t.rich("configuredBucket", {
                bucket: connection.bucket,
                region: connection.region,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : connection.type === "gcs"
              ? t("configuredGcsBucket", {
                  bucket: connection.bucket,
                })
              : connection.type === "azure"
                ? t("configuredAzureContainer", {
                    accountName: connection.accountName,
                    container: connection.container,
                  })
                : connection.type === "cloudinary"
                  ? t("configuredCloudinary", {
                      cloudName: connection.cloudName,
                    })
                  : connection.type === "gdrive"
                    ? t("configuredGdrive", {
                        folderId: connection.folderId,
                        accountEmail: connection.accountEmail,
                      })
                    : t("configuredSupabaseBucket", {
                        bucket: connection.bucket,
                        projectUrl: connection.projectUrl,
                      })}
        </p>
      )}
      <p className="text-sm text-slate-600">{t("publicAccessHelp")}</p>
      <label className="block max-w-xs space-y-1 text-sm font-medium text-slate-700">
        {t("providerLabel")}
        <select
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          disabled={busy}
          value={provider}
          onChange={(event) =>
            setProvider(
              event.target.value === "supabase"
                ? "supabase"
                : event.target.value === "gcs"
                  ? "gcs"
                  : event.target.value === "azure"
                    ? "azure"
                    : event.target.value === "cloudinary"
                      ? "cloudinary"
                      : event.target.value === "gdrive"
                        ? "gdrive"
                        : "s3",
            )
          }
        >
          <option value="s3">{t("providerS3")}</option>
          <option value="supabase">{t("providerSupabase")}</option>
          <option value="gcs">{t("providerGcs")}</option>
          <option value="azure">{t("providerAzure")}</option>
          <option value="cloudinary">{t("providerCloudinary")}</option>
          <option value="gdrive">{t("providerGdrive")}</option>
        </select>
      </label>
      {provider === "supabase" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("projectUrlLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setProjectUrl(event.target.value)}
              placeholder="https://tenant-project.supabase.co"
              type="url"
              value={projectUrl}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("bucketLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setBucket(event.target.value)}
              placeholder="tenant-assets"
              type="text"
              value={bucket}
            />
          </label>
        </div>
      ) : provider === "gcs" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("bucketLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setBucket(event.target.value)}
              placeholder="tenant-assets"
              type="text"
              value={bucket}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("publicBaseUrlLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setPublicBaseUrl(event.target.value)}
              placeholder="https://storage.googleapis.com/tenant-assets"
              type="url"
              value={publicBaseUrl}
            />
          </label>
        </div>
      ) : provider === "azure" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("azureAccountNameLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) =>
                setAzureAccountName(event.target.value.toLowerCase())
              }
              placeholder="tenantassets"
              type="text"
              value={azureAccountName}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("azureContainerLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) =>
                setAzureContainer(event.target.value.toLowerCase())
              }
              placeholder="tenant-assets"
              type="text"
              value={azureContainer}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            {t("publicBaseUrlLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setPublicBaseUrl(event.target.value)}
              placeholder="https://tenantassets.blob.core.windows.net/tenant-assets"
              type="url"
              value={publicBaseUrl}
            />
          </label>
        </div>
      ) : provider === "cloudinary" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            {t("cloudNameLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) =>
                setCloudinaryCloudName(event.target.value)
              }
              placeholder="tenant-cloud"
              type="text"
              value={cloudinaryCloudName}
            />
          </label>
        </div>
      ) : provider === "gdrive" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("gdriveFolderIdLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setGdriveFolderId(event.target.value)}
              value={gdriveFolderId}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("gdriveAccountEmailLabel")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setGdriveAccountEmail(event.target.value)}
              type="email"
              value={gdriveAccountEmail}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              label: t("endpointLabel"),
              value: endpoint,
              set: setEndpoint,
              placeholder: "https://s3.example.com",
              type: "url",
            },
            {
              label: t("regionLabel"),
              value: region,
              set: setRegion,
              placeholder: "ap-south-1",
              type: "text",
            },
            {
              label: t("bucketLabel"),
              value: bucket,
              set: setBucket,
              placeholder: "tenant-assets",
              type: "text",
            },
            {
              label: t("publicBaseUrlLabel"),
              value: publicBaseUrl,
              set: setPublicBaseUrl,
              placeholder: "https://cdn.example.com",
              type: "url",
            },
          ].map((field) => (
            <label
              className="space-y-1 text-sm font-medium text-slate-700"
              key={field.label}
            >
              {field.label}
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
                disabled={busy}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                type={field.type}
                value={field.value}
              />
            </label>
          ))}
        </div>
      )}
      {provider === "s3" && (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              checked={pathStyle}
              disabled={busy}
              onChange={(event) => setPathStyle(event.target.checked)}
              type="checkbox"
            />
            {t("pathStyleLabel")}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              {t("accessKeyIdLabel")}
              {connection ? ` ${t("keepKeyHint")}` : ""}
              <input
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
                disabled={busy}
                onChange={(event) => setAccessKeyId(event.target.value)}
                type="password"
                value={accessKeyId}
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              {t("secretAccessKeyLabel")}
              {connection ? ` ${t("keepKeyHint")}` : ""}
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
                disabled={busy}
                onChange={(event) => setSecretAccessKey(event.target.value)}
                type="password"
                value={secretAccessKey}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm font-medium text-slate-700">
            {t("sessionTokenLabel")}
            <input
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) => setSessionToken(event.target.value)}
              type="password"
              value={sessionToken}
            />
          </label>
        </>
      )}
      {provider === "supabase" && (
        <label className="block space-y-1 text-sm font-medium text-slate-700">
          {t("serviceKeyLabel")}
          {connection?.type === "supabase" ? ` ${t("keepKeyHint")}` : ""}
          <input
            autoComplete="new-password"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
            disabled={busy}
            onChange={(event) => setAccessKeyId(event.target.value)}
            type="password"
            value={accessKeyId}
          />
        </label>
      )}
      {provider === "gcs" && (
        <label className="block space-y-1 text-sm font-medium text-slate-700">
          {t("gcsServiceAccountLabel")}
          {connection?.type === "gcs" ? ` ${t("keepKeyHint")}` : ""}
          <textarea
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs font-normal"
            disabled={busy}
            onChange={(event) => setServiceAccountJson(event.target.value)}
            placeholder={'{"client_email":"...","private_key":"..."}'}
            rows={8}
            value={serviceAccountJson}
          />
        </label>
      )}
      {provider === "azure" && (
        <label className="block space-y-1 text-sm font-medium text-slate-700">
          {t("azureAccountKeyLabel")}
          {connection?.type === "azure" ? ` ${t("keepKeyHint")}` : ""}
          <input
            autoComplete="new-password"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
            disabled={busy}
            onChange={(event) => setAzureAccountKey(event.target.value)}
            type="password"
            value={azureAccountKey}
          />
        </label>
      )}
      {provider === "cloudinary" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("cloudinaryApiKeyLabel")}
            {connection?.type === "cloudinary"
              ? ` ${t("keepKeyHint")}`
              : ""}
            <input
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) =>
                setCloudinaryApiKey(event.target.value)
              }
              type="password"
              value={cloudinaryApiKey}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            {t("cloudinaryApiSecretLabel")}
            {connection?.type === "cloudinary"
              ? ` ${t("keepKeyHint")}`
              : ""}
            <input
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              disabled={busy}
              onChange={(event) =>
                setCloudinaryApiSecret(event.target.value)
              }
              type="password"
              value={cloudinaryApiSecret}
            />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          {t("saveSettings")}
        </button>
        {connection && (
          <>
            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={() => void testConnection()}
              type="button"
            >
              {t("testConnection")}
            </button>
            <button
              className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => void remove()}
              type="button"
            >
              {t("removeStorage")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
