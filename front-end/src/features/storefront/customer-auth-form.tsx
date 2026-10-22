"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CustomerAuthForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
            ? "Too many attempts. Wait before trying again."
            : code === "account_exists"
              ? "An account already exists. Sign in instead."
              : register
                ? "Check the email and use a password of at least 14 characters."
                : "Email or password is incorrect.",
        );
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("The request could not reach the server. Please try again.");
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
        Email
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
        Password{register ? " (14+ characters)" : ""}
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
        {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
      </button>
      <button
        className="w-full text-sm font-medium text-indigo-700 underline"
        onClick={() => {
          setRegister((current) => !current);
          setError("");
        }}
        type="button"
      >
        {register
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
    </form>
  );
}
