"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function TenantRazorpaySettingsForm({
  initialConnection,
}: {
  initialConnection: {
    keyId: string;
    credentialsConfigured: boolean;
  } | null;
}) {
  const t = useTranslations("TenantRazorpay");
  const [keyId, setKeyId] = useState(initialConnection?.keyId ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [configured, setConfigured] = useState(Boolean(initialConnection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = {
        keyId,
        ...(keySecret ? { keySecret } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      };
      const response = await fetch("/api/tenant/razorpay", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(t("saveFailed"));
        return;
      }
      setConfigured(true);
      setKeySecret("");
      setWebhookSecret("");
      setNotice(t("settingsSaved"));
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/razorpay", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(t("removeFailed"));
        return;
      }
      setConfigured(false);
      setKeyId("");
      setNotice(t("settingsRemoved"));
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("description")}</p>
      </div>
      {configured && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t("configured")}
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      <label className="block space-y-1 text-sm font-medium">
        {t("keyId")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          value={keyId}
          onChange={(event) => setKeyId(event.target.value)}
          placeholder="rzp_test_..."
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        {t("keySecret")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          type="password"
          value={keySecret}
          onChange={(event) => setKeySecret(event.target.value)}
          placeholder={configured ? t("keepCurrentHint") : ""}
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        {t("webhookSecret")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          type="password"
          value={webhookSecret}
          onChange={(event) => setWebhookSecret(event.target.value)}
          placeholder={configured ? t("keepCurrentHint") : ""}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? t("saving") : t("save")}
        </button>
        {configured && (
          <button
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t("remove")}
          </button>
        )}
      </div>
    </section>
  );
}
