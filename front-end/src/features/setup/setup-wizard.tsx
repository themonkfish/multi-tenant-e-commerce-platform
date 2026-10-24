"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";

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
  invitations: z.literal("manual"),
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
        setError(describeError(body));
        return;
      }
      const result = PreflightResponseSchema.safeParse(body);
      if (!result.success) {
        setError("The server returned an invalid readiness result.");
        return;
      }
      setPreflight(result.data);
    } catch {
      setError("The readiness check could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function beginSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!preflight) {
      setError("Run the server readiness check before continuing.");
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
        setError(describeError(body));
        return;
      }

      const result = BootstrapResponseSchema.safeParse(body);
      if (!result.success) {
        setError("The setup response was invalid. Please retry.");
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
      setError("Setup could not reach the server. Please try again.");
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
        setError(describeError(body));
        return;
      }

      const result = CompleteResponseSchema.safeParse(body);
      if (!result.success) {
        setError("The setup response was invalid. Please retry.");
        return;
      }
      setWizard({
        step: "recovery",
        codes: result.data.recoveryCodes,
        platformName: wizard.platformName,
        platformDomain: wizard.platformDomain,
      });
    } catch {
      setError("Setup could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (wizard.step === "recovery") {
    return (
      <section className="space-y-5" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading" className="text-xl font-semibold">
          Save your recovery codes
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Each code is shown once and can be used for one sign-in instead of
          your authenticator. Store them somewhere secure.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-4 font-mono text-sm">
          {wizard.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="space-y-2 rounded-lg border border-slate-200 p-4 text-sm leading-6">
          <h3 className="font-semibold">Next: create your first Host</h3>
          <ol className="list-decimal space-y-1 pl-5 text-slate-600">
            <li>Remove SETUP_TOKEN from the deployment environment.</li>
            <li>
              Sign in to {wizard.platformName} at{" "}
              <Link
                className="font-medium text-indigo-700 underline"
                href="/en/super-admin/login"
              >
                Super Admin sign-in
              </Link>
              .
            </li>
            <li>
              Create and activate a Host for {wizard.platformDomain}, then
              invite its owner.
            </li>
            <li>
              Share the one-time invitation link manually; email delivery is not
              configured.
            </li>
          </ol>
        </div>
        <Link
          className="inline-flex rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
          href="/en/super-admin/login"
        >
          Continue to sign in
        </Link>
      </section>
    );
  }

  if (wizard.step === "totp") {
    return (
      <form className="space-y-5" onSubmit={completeSetup}>
        <div>
          <h2 className="text-xl font-semibold">Enroll an authenticator</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Scan the QR code with an authenticator app, then enter its current
            six-digit code to finish setup.
          </p>
        </div>
        {/* This one-time enrollment QR intentionally contains the new admin's TOTP secret. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="h-48 w-48 rounded-lg border border-slate-200"
          src={wizard.qrCodeDataUrl}
          alt="One-time authenticator enrollment QR code"
        />
        <p className="break-all rounded-md bg-slate-100 p-3 font-mono text-sm">
          Manual setup key: {wizard.secret}
        </p>
        <label className="block space-y-2 text-sm font-medium" htmlFor="code">
          Authenticator code
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
          {busy ? "Verifying…" : "Verify and finish setup"}
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
        <h2 className="text-xl font-semibold">Create the first admin</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Bootstrap is available once and requires the token configured by the
          deployment operator.
        </p>
      </div>
      <Field id="setupToken" label="One-time setup token">
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
      <Field id="email" label="Super Admin email">
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      <Field id="password" label="Password (at least 14 characters)">
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
      <Field id="platformDomain" label="Platform domain">
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="platformDomain"
          name="platformDomain"
          placeholder="platform.example.com"
          autoComplete="url"
          required
        />
      </Field>
      <Field id="reservedSubdomains" label="Reserved subdomains">
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
        Use a comma-separated list of host labels to reserve, such as admin,
        www, and api.
      </p>
      <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">
          Platform theme and legal links
        </legend>
        <Field id="platformName" label="Platform name">
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
          <Field id="primaryColor" label="Primary brand color">
            <input
              className="h-10 w-full rounded-md border border-slate-300 p-1"
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue="#4338CA"
              required
            />
          </Field>
          <Field id="accentColor" label="Accent brand color">
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
        <Field id="termsUrl" label="Terms of service URL (optional)">
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            id="termsUrl"
            name="termsUrl"
            type="url"
            pattern="https://.*"
            placeholder="https://platform.example.com/terms"
          />
        </Field>
        <Field id="privacyUrl" label="Privacy policy URL (optional)">
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
          These settings brand the platform shell and expose legal links; they
          do not replace tenant storefront settings.
        </p>
      </fieldset>
      <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
        <h3 className="font-semibold">Invitation delivery</h3>
        <p className="text-slate-600">
          Email delivery is not configured. Host and Tenant invitations are
          created as one-time links to share manually.
        </p>
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
        {busy ? "Checking…" : "Verify server configuration and store"}
      </button>
      {preflight && (
        <p className="text-sm text-green-800" role="status">
          {preflight.platformStore} platform store is reachable; required
          security configuration is present. Invitations will be manual.
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
          ? "Starting setup…"
          : preflight
            ? "Continue to two-factor setup"
            : "Check readiness to continue"}
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

function describeError(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    const messages: Record<string, string> = {
      setup_token_not_configured:
        "The deployment operator has not configured SETUP_TOKEN.",
      server_configuration_invalid:
        "Required security settings are missing or invalid. Check PLATFORM_SECRET_KEY, SESSION_SECRET, and platform-store configuration.",
      platform_store_unavailable:
        "The platform store is unavailable. Check its URL, credentials, and migrations, then retry the readiness check.",
      invalid_setup_token: "The setup token is incorrect.",
      invalid_totp_code: "That authenticator code is not valid. Try again.",
      invalid_platform_domain:
        "Use a valid hostname such as platform.example.com without a path, port, or scheme.",
      invalid_reserved_subdomain:
        "Reserved subdomains must be simple host labels, such as admin or api, and cannot match the platform domain.",
      rate_limited: "Too many attempts. Wait before trying again.",
      not_found: "Platform setup has already been completed.",
      setup_not_available: "The setup session is no longer available.",
      bootstrap_already_started:
        "Setup was already started for another password. Use the original password.",
    };
    return (
      messages[body.error] ?? "Setup could not be completed. Please retry."
    );
  }
  return "Setup could not be completed. Please retry.";
}
