"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function TenantDataExport() {
  const t = useTranslations("TenantPortal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function exportData() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tenant/export", { method: "POST" });
      if (!response.ok) {
        setError(
          response.status === 429 ? t("tooManyExports") : t("exportFailed"),
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
      setError(t("exportRequestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="mb-2 font-semibold">{t("exportTitle")}</h3>
      <p className="mb-4 text-sm text-slate-600">{t("exportDescription")}</p>
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
        {busy ? t("preparingExport") : t("downloadJson")}
      </button>
    </div>
  );
}
