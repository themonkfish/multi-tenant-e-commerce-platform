"use client";

import { useState, type FormEvent } from "react";

export function CustomerPasswordResetForm({
  locale,
  tenantId,
  token,
}: {
  locale: string;
  tenantId?: string;
  token?: string;
}) {
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/customer/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          token,
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        setError("This reset link is invalid or has expired.");
        return;
      }
      setComplete(true);
    } catch {
      setError("The request could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (complete) {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        Password reset complete.{" "}
        <a className="underline" href={`/${locale}/customer/login`}>
          Sign in
        </a>
      </p>
    );
  }

  if (!tenantId || !token) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">
        This reset link is incomplete or invalid.
      </p>
    );
  }

  return (
    <form
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
      onSubmit={submit}
    >
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <label className="block space-y-2 text-sm font-medium">
        New password (14+ characters)
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={128}
          required
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        className="w-full rounded-md bg-indigo-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? "Please wait…" : "Reset password"}
      </button>
    </form>
  );
}
