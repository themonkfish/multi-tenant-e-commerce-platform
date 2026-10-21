"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function HostInviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/host/invitations/accept", {
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
            ? "This invitation is invalid, expired, or has already been used. Ask the Super Admin for a new invite."
            : code === "rate_limited"
              ? "Too many attempts. Wait before trying again."
              : "The invitation could not be accepted. Please try again.",
        );
        return;
      }
      router.replace("/host");
      router.refresh();
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block space-y-2 text-sm font-medium" htmlFor="password">
        Create password (at least 14 characters)
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
        Confirm password
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
        {busy ? "Accepting invitation…" : "Accept invitation"}
      </button>
    </form>
  );
}
