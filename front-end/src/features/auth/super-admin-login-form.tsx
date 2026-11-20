"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function SuperAdminLoginForm() {
  const router = useRouter();
  const t = useTranslations("SuperAdminAuth");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/super-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          code: form.get("code"),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429 ? t("tooManyAttempts") : t("invalidLogin"),
        );
        return;
      }
      router.push("/super-admin");
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block space-y-2 text-sm font-medium" htmlFor="email">
        {t("email")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>
      <label className="block space-y-2 text-sm font-medium" htmlFor="password">
        {t("password")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="block space-y-2 text-sm font-medium" htmlFor="code">
        {t("authCode")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          minLength={6}
          maxLength={16}
          required
        />
      </label>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
        type="submit"
        disabled={busy}
      >
        {busy ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
