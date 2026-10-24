"use client";

import { useState } from "react";
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
  const [connection, setConnection] = useState(initialConnection);
  const [endpoint, setEndpoint] = useState(initialConnection?.endpoint ?? "");
  const [region, setRegion] = useState(initialConnection?.region ?? "");
  const [bucket, setBucket] = useState(initialConnection?.bucket ?? "");
  const [publicBaseUrl, setPublicBaseUrl] = useState(
    initialConnection?.publicBaseUrl ?? "",
  );
  const [pathStyle, setPathStyle] = useState(
    initialConnection?.pathStyle ?? false,
  );
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = {
        type: "s3",
        ...(endpoint ? { endpoint } : {}),
        region,
        bucket,
        publicBaseUrl,
        pathStyle,
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKey ? { secretAccessKey } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      } satisfies Partial<z.infer<typeof TenantStorageConnectionInputSchema>>;
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
            ? "Storage URLs must resolve to publicly reachable HTTPS hosts."
            : code === "storage_credentials_required"
              ? "Enter an access key ID and secret access key."
              : code === "rate_limited"
                ? "Too many changes. Wait and try again."
                : "Storage settings could not be saved.",
        );
        return;
      }
      const parsed =
        typeof result === "object" && result !== null && "connection" in result
          ? TenantStorageConnectionViewSchema.safeParse(result.connection)
          : null;
      if (!parsed?.success) {
        setError("The platform returned invalid storage settings.");
        return;
      }
      setConnection(parsed.data);
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setNotice("S3-compatible storage settings saved.");
    } catch {
      setError("Could not reach the platform storage settings.");
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
        setError("Storage connection test could not be completed.");
        return;
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("status" in body) ||
        (body.status !== "healthy" && body.status !== "unhealthy")
      ) {
        setError("The platform returned an invalid storage test result.");
        return;
      }
      setNotice(
        body.status === "healthy"
          ? "Storage bucket connection is healthy."
          : "The storage bucket could not be reached. Check the endpoint, bucket, and credentials.",
      );
    } catch {
      setError("Could not reach the platform storage test.");
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
        setError("Storage settings could not be removed.");
        return;
      }
      setConnection(null);
      setEndpoint("");
      setRegion("");
      setBucket("");
      setPublicBaseUrl("");
      setPathStyle(false);
      setNotice("Storage settings removed.");
    } catch {
      setError("Could not reach the platform storage settings.");
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
          Configured bucket <strong>{connection.bucket}</strong> in{" "}
          <strong>{connection.region}</strong>. Credentials are stored in the
          encrypted vault and are never displayed.
        </p>
      )}
      <p className="text-sm text-slate-600">
        Configure bucket or CDN public-read access at your storage provider. The
        application does not change bucket policies or make private objects
        public.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          {
            label: "S3 endpoint (optional; leave blank for AWS S3)",
            value: endpoint,
            set: setEndpoint,
            placeholder: "https://s3.example.com",
            type: "url",
          },
          {
            label: "Region",
            value: region,
            set: setRegion,
            placeholder: "ap-south-1",
            type: "text",
          },
          {
            label: "Bucket",
            value: bucket,
            set: setBucket,
            placeholder: "tenant-assets",
            type: "text",
          },
          {
            label: "Public asset base URL",
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
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          checked={pathStyle}
          disabled={busy}
          onChange={(event) => setPathStyle(event.target.checked)}
          type="checkbox"
        />
        Use path-style requests (often required by S3-compatible services)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Access key ID {connection ? "(optional to keep current key)" : ""}
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
          Secret access key {connection ? "(optional to keep current key)" : ""}
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
        Session token (optional)
        <input
          autoComplete="off"
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
          disabled={busy}
          onChange={(event) => setSessionToken(event.target.value)}
          type="password"
          value={sessionToken}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          Save storage settings
        </button>
        {connection && (
          <>
            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={() => void testConnection()}
              type="button"
            >
              Test connection
            </button>
            <button
              className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => void remove()}
              type="button"
            >
              Remove storage
            </button>
          </>
        )}
      </div>
    </div>
  );
}
