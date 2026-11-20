"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  PlatformSettingsSchema,
  type PlatformSettings,
} from "@/core/domain/platform-settings";

export function PlatformSettingsForm({
  initialSettings,
}: {
  initialSettings: PlatformSettings;
}) {
  const t = useTranslations("SuperAdminSettings");
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/platform/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          primaryColor: form.get("primaryColor"),
          accentColor: form.get("accentColor"),
          ...(String(form.get("termsUrl") ?? "").trim()
            ? { termsUrl: String(form.get("termsUrl")).trim() }
            : {}),
          ...(String(form.get("privacyUrl") ?? "").trim()
            ? { privacyUrl: String(form.get("privacyUrl")).trim() }
            : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(t("saveFailed"));
        return;
      }
      if (typeof body === "object" && body !== null && "settings" in body) {
        const parsed = PlatformSettingsSchema.safeParse(body.settings);
        if (parsed.success) {
          setSettings(parsed.data);
        }
      }
      setSaved(true);
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="platform-settings-heading" className="space-y-4">
      <div>
        <h2 id="platform-settings-heading" className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("description")}</p>
      </div>
      <form
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
        onSubmit={submit}
      >
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          {t("platformName")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="name"
            defaultValue={settings.name}
            maxLength={120}
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("primaryColor")}
          <input
            className="h-10 w-full rounded-md border border-slate-300 px-2"
            name="primaryColor"
            type="color"
            defaultValue={settings.primaryColor}
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("accentColor")}
          <input
            className="h-10 w-full rounded-md border border-slate-300 px-2"
            name="accentColor"
            type="color"
            defaultValue={settings.accentColor}
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("termsUrl")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="termsUrl"
            type="url"
            defaultValue={settings.termsUrl ?? ""}
            placeholder="https://example.com/terms"
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("privacyUrl")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            name="privacyUrl"
            type="url"
            defaultValue={settings.privacyUrl ?? ""}
            placeholder="https://example.com/privacy"
          />
        </label>
        {error && (
          <p className="text-sm text-red-700 sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700 sm:col-span-2" role="status">
            {t("settingsSaved")}
          </p>
        )}
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? t("saving") : t("saveSettings")}
          </button>
        </div>
      </form>
    </section>
  );
}
