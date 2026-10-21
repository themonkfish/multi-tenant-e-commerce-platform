"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function HostLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/host/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Wait before trying again."
            : "Email or password is incorrect, or the host is unavailable.",
        );
        return;
      }
      router.push("/host");
      router.refresh();
    } catch {
      setError("Sign-in could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block space-y-2 text-sm font-medium" htmlFor="email">
        Email
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
        Password
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
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
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
