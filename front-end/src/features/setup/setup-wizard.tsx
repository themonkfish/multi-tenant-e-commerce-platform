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

type WizardState =
  | { step: "bootstrap" }
  | {
      step: "totp";
      email: string;
      setupToken: string;
      secret: string;
      qrCodeDataUrl: string;
    }
  | { step: "recovery"; codes: string[] };

export function SetupWizard() {
  const [wizard, setWizard] = useState<WizardState>({ step: "bootstrap" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function beginSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupToken: form.get("setupToken"),
          email: form.get("email"),
          password: form.get("password"),
          platformDomain: form.get("platformDomain"),
          reservedSubdomains: ["admin", "www", "api"],
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
      setWizard({ step: "recovery", codes: result.data.recoveryCodes });
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
        <Link
          className="inline-flex rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
          href="/super-admin/login"
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
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? "Starting setup…" : "Continue to two-factor setup"}
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
      invalid_setup_token: "The setup token is incorrect.",
      invalid_totp_code: "That authenticator code is not valid. Try again.",
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
