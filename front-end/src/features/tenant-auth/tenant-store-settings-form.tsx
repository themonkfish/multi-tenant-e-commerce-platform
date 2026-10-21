"use client";

import { useState, type FormEvent } from "react";
import {
  TenantStoreSettingsSchema,
  type TenantStoreSettings,
} from "@/core/domain/host-portal";

function csvValues(value: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function TenantStoreSettingsForm({
  initialSettings,
}: {
  initialSettings: TenantStoreSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawSettings = {
      branding: {
        name: form.get("brandName"),
        description: form.get("description"),
        ...(String(form.get("logoUrl") ?? "").trim()
          ? { logoUrl: String(form.get("logoUrl")).trim() }
          : {}),
        primaryColor: form.get("primaryColor"),
        accentColor: form.get("accentColor"),
      },
      locale: {
        defaultLocale: form.get("defaultLocale"),
        locales: csvValues(form.get("locales")),
        currency: String(form.get("currency") ?? "")
          .trim()
          .toUpperCase(),
        currencies: csvValues(form.get("currencies")).map((currency) =>
          currency.toUpperCase(),
        ),
      },
    };
    const validated = TenantStoreSettingsSchema.safeParse(rawSettings);
    if (!validated.success) {
      setError("Check the brand, locale, URL, and ISO currency values.");
      setNotice("");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated.data),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? "Too many updates. Wait before trying again."
            : "Settings could not be saved. Verify the values and try again.",
        );
        return;
      }
      const responseSettings =
        typeof body === "object" && body !== null && "settings" in body
          ? TenantStoreSettingsSchema.safeParse(body.settings)
          : null;
      if (!responseSettings?.success) {
        setError("The server returned invalid settings.");
        return;
      }
      setSettings(responseSettings.data);
      setNotice("Store settings saved.");
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
      onSubmit={submit}
    >
      <label className="space-y-1 text-sm font-medium">
        Store display name
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="brandName"
          defaultValue={settings.branding.name}
          maxLength={120}
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Logo URL (HTTPS)
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="logoUrl"
          type="url"
          defaultValue={settings.branding.logoUrl ?? ""}
          placeholder="https://cdn.example.com/logo.png"
        />
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Store description
        <textarea
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="description"
          defaultValue={settings.branding.description}
          maxLength={500}
          rows={3}
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Primary color
        <input
          className="h-11 w-full rounded-md border border-slate-300 p-1"
          name="primaryColor"
          type="color"
          defaultValue={settings.branding.primaryColor}
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Accent color
        <input
          className="h-11 w-full rounded-md border border-slate-300 p-1"
          name="accentColor"
          type="color"
          defaultValue={settings.branding.accentColor}
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Default locale
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="defaultLocale"
          defaultValue={settings.locale.defaultLocale}
          placeholder="en or en-US"
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Supported locales (comma-separated)
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="locales"
          defaultValue={settings.locale.locales.join(", ")}
          placeholder="en, fr-CA"
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Default currency (ISO 4217)
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
          name="currency"
          defaultValue={settings.locale.currency}
          maxLength={3}
          required
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Supported currencies (comma-separated)
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
          name="currencies"
          defaultValue={settings.locale.currencies.join(", ")}
          placeholder="USD, EUR"
          required
        />
      </label>
      {(error || notice) && (
        <p
          className={`text-sm sm:col-span-2 ${error ? "text-red-700" : "text-green-700"}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
      <div className="sm:col-span-2">
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "Saving…" : "Save store settings"}
        </button>
      </div>
    </form>
  );
}
