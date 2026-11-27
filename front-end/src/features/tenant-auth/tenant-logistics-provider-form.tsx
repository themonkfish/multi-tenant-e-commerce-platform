"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  TenantLogisticsConnectionViewSchema,
} from "@/core/domain/tenant-config";
import { z } from "zod";

type LogisticsConnection = z.infer<typeof TenantLogisticsConnectionViewSchema>;

export function TenantLogisticsProviderForm({
  initialConnection,
}: {
  initialConnection: LogisticsConnection | null;
}) {
  const t = useTranslations("TenantLogistics");
  const [connection, setConnection] = useState(initialConnection);
  const [provider, setProvider] = useState<"shiprocket" | "bluedart">(
    initialConnection?.type ?? "bluedart",
  );
  const [apiEmail, setApiEmail] = useState(
    initialConnection?.type === "shiprocket"
      ? initialConnection.apiEmail
      : "",
  );
  const [apiPassword, setApiPassword] = useState("");
  const [pickupLocation, setPickupLocation] = useState(
    initialConnection?.type === "shiprocket"
      ? initialConnection.pickupLocation
      : "",
  );
  const [baseUrl, setBaseUrl] = useState(
    initialConnection?.type === "bluedart"
      ? initialConnection.baseUrl
      : "",
  );
  const [customerCode, setCustomerCode] = useState(
    initialConnection?.type === "bluedart"
      ? initialConnection.customerCode
      : "",
  );
  const [loginId, setLoginId] = useState(
    initialConnection?.type === "bluedart"
      ? initialConnection.loginId
      : "",
  );
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        provider === "shiprocket"
          ? {
              type: "shiprocket",
              apiEmail,
              pickupLocation,
              ...(apiPassword ? { apiPassword } : {}),
            }
          : {
              type: "bluedart",
              baseUrl,
              customerCode,
              loginId,
              ...(licenseKey ? { licenseKey } : {}),
            };
      const response = await fetch("/api/tenant/logistics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        setError(t("saveFailed"));
        return;
      }
      const parsed =
        typeof result === "object" && result !== null && "connection" in result
          ? TenantLogisticsConnectionViewSchema.safeParse(result.connection)
          : null;
      if (!parsed?.success) {
        setError(t("invalidSettings"));
        return;
      }
      setConnection(parsed.data);
      setApiPassword("");
      setLicenseKey("");
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
      const response = await fetch("/api/tenant/logistics", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(t("removeFailed"));
        return;
      }
      setConnection(null);
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
      {connection && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t("configured", { provider: connection.type })}
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      <label className="block space-y-1 text-sm font-medium">
        {t("provider")}
        <select
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as "shiprocket" | "bluedart")
          }
        >
          <option value="shiprocket">Shiprocket</option>
          <option value="bluedart">BlueDart</option>
        </select>
      </label>
      {provider === "shiprocket" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            {t("apiEmail")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              type="email"
              value={apiEmail}
              onChange={(event) => setApiEmail(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            {t("pickupLocation")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={pickupLocation}
              onChange={(event) => setPickupLocation(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("apiPassword")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              type="password"
              value={apiPassword}
              onChange={(event) => setApiPassword(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("baseUrl")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            {t("customerCode")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={customerCode}
              onChange={(event) => setCustomerCode(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            {t("loginId")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("licenseKey")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              type="password"
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
            />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? t("saving") : t("save")}
        </button>
        {connection && (
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
