"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function TenantInviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useTranslations("TenantInvite");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError(t("passwordMismatch"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tenant/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "invite_invalid_or_expired"
            ? t("inviteInvalid")
            : code === "rate_limited"
              ? t("tooManyAttempts")
              : t("acceptFailed"),
        );
        return;
      }
      router.replace("/tenant");
      router.refresh();
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block space-y-2 text-sm font-medium" htmlFor="password">
        {t("createPassword")}
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
      </label>
      <label
        className="block space-y-2 text-sm font-medium"
        htmlFor="confirmPassword"
      >
        {t("confirmPassword")}
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={14}
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
        className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? t("accepting") : t("acceptInvitation")}
      </button>
    </form>
  );
}
