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

function parseCurrencyAmount(
  value: FormDataEntryValue | null,
  currency: string,
): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (!/^[A-Z]{3}$/.test(currency)) return Number.NaN;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return Number.NaN;
  const fractionDigits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > fractionDigits) return Number.NaN;
  const amount =
    Number(whole) * 10 ** fractionDigits +
    Number(fraction.padEnd(fractionDigits, "0") || 0);
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}

function displayCurrencyAmount(amount: number, currency: string): string {
  const fractionDigits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return (amount / 10 ** fractionDigits).toFixed(fractionDigits);
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
    const currency = String(form.get("currency") ?? "")
      .trim()
      .toUpperCase();
    const flatRate = parseCurrencyAmount(
      form.get("shippingFlatRate"),
      currency,
    );
    const freeShippingThreshold = parseCurrencyAmount(
      form.get("freeShippingThreshold"),
      currency,
    );
    if (
      flatRate === undefined ||
      Number.isNaN(flatRate) ||
      (freeShippingThreshold !== undefined &&
        (Number.isNaN(freeShippingThreshold) || freeShippingThreshold <= 0))
    ) {
      setError("Enter valid shipping amounts in the default store currency.");
      setNotice("");
      return;
    }
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
        currency,
        currencies: csvValues(form.get("currencies")).map((currency) =>
          currency.toUpperCase(),
        ),
      },
      shipping: {
        flatRate,
        ...(freeShippingThreshold !== undefined
          ? { freeShippingThreshold }
          : {}),
      },
    };
    const validated = TenantStoreSettingsSchema.safeParse(rawSettings);
    if (!validated.success) {
      setError(
        "Check the brand, locale, shipping amounts, URL, and ISO currency values.",
      );
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
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold">Shipping rates</legend>
        <p className="text-xs text-slate-600">
          Rates use the default store currency and are applied to verified
          server-side product prices. Leave the free-shipping threshold blank to
          always charge the flat rate.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Flat shipping fee ({settings.locale.currency})
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="shippingFlatRate"
              inputMode="decimal"
              defaultValue={displayCurrencyAmount(
                settings.shipping.flatRate,
                settings.locale.currency,
              )}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Free shipping at subtotal ({settings.locale.currency})
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="freeShippingThreshold"
              inputMode="decimal"
              defaultValue={
                settings.shipping.freeShippingThreshold === undefined
                  ? ""
                  : displayCurrencyAmount(
                      settings.shipping.freeShippingThreshold,
                      settings.locale.currency,
                    )
              }
              placeholder="Optional"
            />
          </label>
        </div>
      </fieldset>
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
