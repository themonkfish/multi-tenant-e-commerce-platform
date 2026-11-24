"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function CustomerAuthForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const t = useTranslations("CustomerAuth");
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);

  async function requestPasswordReset(email: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/customer/auth/password-reset/request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      if (response.ok) {
        setResetRequested(true);
      } else {
        setError(t("resetRequestFailed"));
      }
    } catch {
      setError(t("serverUnreachable"));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        register ? "/api/customer/auth/register" : "/api/customer/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? t("tooManyAttempts")
            : code === "account_exists"
              ? t("accountExists")
              : register
                ? t("registrationInvalid")
                : t("loginInvalid"),
        );
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError(t("serverUnreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label
        className="block space-y-2 text-sm font-medium"
        htmlFor="customer-email"
      >
        {t("email")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="customer-email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>
      <label
        className="block space-y-2 text-sm font-medium"
        htmlFor="customer-password"
      >
        {t("password")}
        {register ? ` (${t("passwordMinimum")})` : ""}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="customer-password"
          name="password"
          type="password"
          autoComplete={register ? "new-password" : "current-password"}
          minLength={register ? 14 : undefined}
          maxLength={128}
          required
        />
      </label>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="w-full rounded-md bg-indigo-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? t("pleaseWait") : register ? t("createAccount") : t("signIn")}
      </button>
      <button
        className="w-full text-sm font-medium text-indigo-700 underline"
        onClick={() => {
          setRegister((current) => !current);
          setError("");
        }}
        type="button"
      >
        {register ? t("existingAccountPrompt") : t("newAccountPrompt")}
      </button>
      {!register && (
        <button
          className="w-full text-sm font-medium text-indigo-700 underline"
          disabled={busy}
          onClick={() => {
            const form = document.querySelector<HTMLFormElement>(
              "form:has(#customer-email)",
            );
            const email = form?.elements.namedItem("email");
            if (email instanceof HTMLInputElement && email.checkValidity()) {
              void requestPasswordReset(email.value);
            } else {
              setError(t("emailRequired"));
            }
          }}
          type="button"
        >
          {t("forgotPassword")}
        </button>
      )}
      {resetRequested && (
        <p className="text-sm text-emerald-700" role="status">
          {t("resetRequested")}
        </p>
      )}
    </form>
  );
}
