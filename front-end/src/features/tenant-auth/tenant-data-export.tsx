"use client";

import { useState } from "react";

export function TenantDataExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function exportData() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tenant/export", { method: "POST" });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many export requests. Wait before trying again."
            : "The tenant export could not be created.",
        );
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "tenant-export.json";
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      setError("The tenant export request could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="mb-2 font-semibold">Export tenant data</h3>
      <p className="mb-4 text-sm text-slate-600">
        Download a secret-free JSON snapshot of tenant metadata, settings,
        staff, connection metadata, orders, and scoped audit events.
      </p>
      {error && (
        <p className="mb-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
        disabled={busy}
        onClick={() => void exportData()}
        type="button"
      >
        {busy ? "Preparing export…" : "Download JSON export"}
      </button>
    </div>
  );
}
