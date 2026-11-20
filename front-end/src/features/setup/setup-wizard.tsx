"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { useTranslations } from "next-intl";

const BootstrapResponseSchema = z.object({
  email: z.email(),
  secret: z.string(),
  qrCodeDataUrl: z.string().startsWith("data:image/png;base64,"),
});

const CompleteResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).length(10),
});
const PreflightResponseSchema = z.object({
  platformStore: z.enum(["file", "supabase"]),
  connection: z.literal("ready"),
  securityConfiguration: z.literal("ready"),
  invitations: z.enum(["email", "manual", "misconfigured"]),
});

type WizardState =
  | { step: "bootstrap" }
  | {
      step: "totp";
      email: string;
      setupToken: string;
      secret: string;
      qrCodeDataUrl: string;
      platformName: string;
      platformDomain: string;
    }
  | {
      step: "recovery";
      codes: string[];
      platformName: string;
      platformDomain: string;
    };

export function SetupWizard() {
  const t = useTranslations("PlatformSetup");
  const [wizard, setWizard] = useState<WizardState>({ step: "bootstrap" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<z.infer<
    typeof PreflightResponseSchema
  > | null>(null);

  async function checkReadiness(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    setError("");
    setBusy(true);
    setPreflight(null);
    try {
      const response = await fetch("/api/setup/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken: form.get("setupToken") }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeError(body, t));
        return;
      }
      const result = PreflightResponseSchema.safeParse(body);
      if (!result.success) {
        setError(t("invalidReadiness"));
        return;
      }
      setPreflight(result.data);
    } catch {
      setError(t("readinessRequestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function beginSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!preflight) {
      setError(t("runReadiness"));
      return;
    }
    const form = new FormData(formElement);
    setError("");
    setBusy(true);
    try {
      const parsedReserved = String(form.get("reservedSubdomains") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const response = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupToken: form.get("setupToken"),
          email: form.get("email"),
          password: form.get("password"),
          platformDomain: form.get("platformDomain"),
          platformSettings: {
            name: form.get("platformName"),
            primaryColor: form.get("primaryColor"),
            accentColor: form.get("accentColor"),
            ...(form.get("termsUrl") ? { termsUrl: form.get("termsUrl") } : {}),
            ...(form.get("privacyUrl")
              ? { privacyUrl: form.get("privacyUrl") }
              : {}),
          },
          reservedSubdomains: parsedReserved.length
            ? parsedReserved
            : ["admin", "www", "api"],
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeError(body, t));
        return;
      }

      const result = BootstrapResponseSchema.safeParse(body);
      if (!result.success) {
        setError(t("invalidSetupResponse"));
        return;
      }
      setWizard({
        step: "totp",
        ...result.data,
        setupToken: String(form.get("setupToken")),
        platformName: String(form.get("platformName")),
        platformDomain: String(form.get("platformDomain")),
      });
    } catch {
      setError(t("setupRequestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function completeSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizard.step !== "totp") {
      return;
    }
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupToken: wizard.setupToken,
          email: wizard.email,
          code: form.get("code"),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeError(body, t));
        return;
      }

      const result = CompleteResponseSchema.safeParse(body);
      if (!result.success) {
        setError(t("invalidSetupResponse"));
        return;
      }
      setWizard({
        step: "recovery",
        codes: result.data.recoveryCodes,
        platformName: wizard.platformName,
        platformDomain: wizard.platformDomain,
      });
    } catch {
      setError(t("setupRequestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  if (wizard.step === "recovery") {
    return (
      <section className="space-y-5" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading" className="text-xl font-semibold">
          {t("saveRecoveryCodes")}
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          {t("recoveryDescription")}
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-4 font-mono text-sm">
          {wizard.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="space-y-2 rounded-lg border border-slate-200 p-4 text-sm leading-6">
          <h3 className="font-semibold">{t("nextCreateHost")}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-slate-600">
            <li>{t("removeSetupToken")}</li>
            <li>
              {t("signInAt", { platformName: wizard.platformName })}{" "}
              <Link
                className="font-medium text-indigo-700 underline"
                href="/en/super-admin/login"
              >
                {t("superAdminSignIn")}
              </Link>
              .
            </li>
            <li>
              {t("createActivateHost", {
                platformDomain: wizard.platformDomain,
              })}
            </li>
            <li>{t("invitationDelivery")}</li>
          </ol>
        </div>
        <Link
          className="inline-flex rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
          href="/en/super-admin/login"
        >
          {t("continueSignIn")}
        </Link>
      </section>
    );
  }

  if (wizard.step === "totp") {
    return (
      <form className="space-y-5" onSubmit={completeSetup}>
        <div>
          <h2 className="text-xl font-semibold">{t("enrollAuthenticator")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t("totpDescription")}
          </p>
        </div>
        {/* This one-time enrollment QR intentionally contains the new admin's TOTP secret. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="h-48 w-48 rounded-lg border border-slate-200"
          src={wizard.qrCodeDataUrl}
          alt={t("qrAlt")}
        />
        <p className="break-all rounded-md bg-slate-100 p-3 font-mono text-sm">
          {t("manualSetupKey", { secret: wizard.secret })}
        </p>
        <label className="block space-y-2 text-sm font-medium" htmlFor="code">
          {t("authenticatorCode")}
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
          />
        </label>
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? t("verifying") : t("verifyFinish")}
        </button>
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={beginSetup}>
      <div>
        <h2 className="text-xl font-semibold">{t("createFirstAdmin")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {t("bootstrapDescription")}
        </p>
      </div>
      <Field id="setupToken" label={t("setupToken")}>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="setupToken"
          name="setupToken"
          type="password"
          autoComplete="off"
          minLength={32}
          onChange={() => setPreflight(null)}
          required
        />
      </Field>
      <Field id="email" label={t("superAdminEmail")}>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      <Field id="password" label={t("passwordLabel")}>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={128}
          required
        />
      </Field>
      <Field id="platformDomain" label={t("platformDomain")}>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="platformDomain"
          name="platformDomain"
          placeholder="platform.example.com"
          autoComplete="url"
          required
        />
      </Field>
      <Field id="reservedSubdomains" label={t("reservedSubdomains")}>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="reservedSubdomains"
          name="reservedSubdomains"
          defaultValue="admin, www, api"
          placeholder="admin, www, api"
          autoComplete="off"
        />
      </Field>
      <p className="text-sm leading-6 text-slate-600">
        {t("reservedSubdomainsHelp")}
      </p>
      <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">
          {t("themeAndLegal")}
        </legend>
        <Field id="platformName" label={t("platformName")}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            id="platformName"
            name="platformName"
            defaultValue="Multi-tenant Commerce Platform"
            maxLength={120}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="primaryColor" label={t("primaryBrandColor")}>
            <input
              className="h-10 w-full rounded-md border border-slate-300 p-1"
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue="#4338CA"
              required
            />
          </Field>
          <Field id="accentColor" label={t("accentBrandColor")}>
            <input
              className="h-10 w-full rounded-md border border-slate-300 p-1"
              id="accentColor"
              name="accentColor"
              type="color"
              defaultValue="#0F766E"
              required
            />
          </Field>
        </div>
        <Field id="termsUrl" label={t("termsUrl")}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            id="termsUrl"
            name="termsUrl"
            type="url"
            pattern="https://.*"
            placeholder="https://platform.example.com/terms"
          />
        </Field>
        <Field id="privacyUrl" label={t("privacyUrl")}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            id="privacyUrl"
            name="privacyUrl"
            type="url"
            pattern="https://.*"
            placeholder="https://platform.example.com/privacy"
          />
        </Field>
        <p className="text-xs leading-5 text-slate-600">
          {t("themeLegalHelp")}
        </p>
      </fieldset>
      <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
        <h3 className="font-semibold">{t("invitationDeliveryTitle")}</h3>
        <p className="text-slate-600">{t("invitationDeliveryHelp")}</p>
      </div>
      <button
        className="rounded-md border border-indigo-300 px-4 py-2 font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
        disabled={busy}
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (form) void checkReadiness(form);
        }}
        type="button"
      >
        {busy ? t("checking") : t("verifyServer")}
      </button>
      {preflight && (
        <p className="text-sm text-green-800" role="status">
          {t("preflightReady", { platformStore: preflight.platformStore })}{" "}
          {preflight.invitations === "email"
            ? t("emailConfigured")
            : preflight.invitations === "misconfigured"
              ? t("emailMisconfigured")
              : t("emailNotConfigured")}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
        disabled={busy || !preflight}
        type="submit"
      >
        {busy
          ? t("startingSetup")
          : preflight
            ? t("continueTwoFactor")
            : t("checkReadiness")}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2 text-sm font-medium" htmlFor={id}>
      {label}
      {children}
    </label>
  );
}

function describeError(body: unknown, t: (key: string) => string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    const messages: Record<string, string> = {
      setup_token_not_configured: t("setupTokenNotConfigured"),
      server_configuration_invalid: t("serverConfigurationInvalid"),
      platform_store_unavailable: t("platformStoreUnavailable"),
      invalid_setup_token: t("invalidSetupToken"),
      invalid_totp_code: t("invalidTotpCode"),
      invalid_platform_domain: t("invalidPlatformDomain"),
      invalid_reserved_subdomain: t("invalidReservedSubdomain"),
      rate_limited: t("tooManyAttempts"),
      not_found: t("setupAlreadyCompleted"),
      setup_not_available: t("setupSessionUnavailable"),
      bootstrap_already_started: t("bootstrapAlreadyStarted"),
    };
    return messages[body.error] ?? t("setupCouldNotComplete");
  }
  return t("setupCouldNotComplete");
}
