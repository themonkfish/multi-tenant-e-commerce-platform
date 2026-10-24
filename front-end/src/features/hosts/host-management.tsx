"use client";

import { useState, type FormEvent } from "react";
import {
  HostConfigSchema,
  type HostConfig,
  type HostStatus,
} from "@/core/domain/host-config";
import { z } from "zod";

const HostResponseSchema = z.object({ host: HostConfigSchema });
const InviteResponseSchema = z.object({
  inviteUrl: z.url(),
  deliveryStatus: z.enum(["sent", "not_configured", "failed"]),
});

function describeHostError(error: unknown): string {
  if (error === "reserved_host_slug") {
    return "That slug is reserved by the platform.";
  }
  if (
    error === "host_domain_in_use" ||
    error === "host_slug_or_domain_in_use"
  ) {
    return "That host slug or domain is already in use.";
  }
  if (error === "invalid_host_domain") {
    return "Enter host domains as names only, such as shop.example.com.";
  }
  if (error === "host_domain_limit_exceeded") {
    return "The number of domains exceeds this host's configured limit.";
  }
  if (error === "rate_limited") {
    return "Too many changes. Wait a few minutes and try again.";
  }
  return "The request could not be completed. Please try again.";
}

function getErrorCode(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body
    ? body.error
    : undefined;
}

function HostOwnerInviteForm({ host }: { host: HostConfig }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState<
    "sent" | "not_configured" | "failed" | ""
  >("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setInviteUrl("");
    setDeliveryStatus("");
    setCopied(false);
    try {
      const response = await fetch(`/api/platform/hosts/${host.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("ownerEmail") }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code = getErrorCode(body);
        setError(
          code === "host_owner_already_exists"
            ? "This email already has a host-owner account."
            : code === "host_must_be_active"
              ? "Activate this host before inviting its owner."
              : describeHostError(code),
        );
        return;
      }
      const parsed = InviteResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid invitation.");
        return;
      }
      setInviteUrl(parsed.data.inviteUrl);
      setDeliveryStatus(parsed.data.deliveryStatus);
      formElement.reset();
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteUrl() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy was blocked. Select the link and copy it manually.");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <form className="flex flex-wrap gap-2" onSubmit={createInvite}>
        <label className="sr-only" htmlFor={`owner-email-${host.id}`}>
          Host owner email
        </label>
        <input
          className="min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
          id={`owner-email-${host.id}`}
          name="ownerEmail"
          type="email"
          autoComplete="email"
          placeholder="owner@example.com"
          required
        />
        <button
          className="rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "Creating invite…" : "Invite owner"}
        </button>
      </form>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {inviteUrl && (
        <div className="space-y-1 rounded-md bg-indigo-50 p-3">
          <p className="text-sm font-medium text-indigo-950">
            {deliveryStatus === "sent"
              ? "Invitation email sent. This one-time fallback link expires in 24 hours."
              : deliveryStatus === "failed"
                ? "Email delivery failed. Share this one-time link securely; it expires in 24 hours."
                : "Email is not configured. Share this one-time link securely; it expires in 24 hours."}
          </p>
          <input
            aria-label="One-time host owner invitation link"
            className="w-full rounded border border-indigo-200 bg-white px-2 py-1 font-mono text-xs"
            readOnly
            value={inviteUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            className="rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
            onClick={() => void copyInviteUrl()}
            type="button"
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>
      )}
    </div>
  );
}

export function HostManagement({
  initialHosts,
}: {
  initialHosts: HostConfig[];
}) {
  const [hosts, setHosts] = useState(initialHosts);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/platform/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug"),
          plan: form.get("plan"),
          maxTenants: Number(form.get("maxTenants")),
          maxCustomDomains: Number(form.get("maxCustomDomains")),
          domains: String(form.get("domains") ?? "")
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
          ...(String(form.get("supportContact") ?? "").trim()
            ? { supportContact: String(form.get("supportContact")).trim() }
            : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeHostError(getErrorCode(body)));
        return;
      }
      const parsed = HostResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid host record.");
        return;
      }
      setHosts((current) =>
        [...current, parsed.data.host].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      formElement.reset();
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(host: HostConfig, status: HostStatus) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/platform/hosts/${host.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeHostError(getErrorCode(body)));
        return;
      }
      const parsed = HostResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid host record.");
        return;
      }
      setHosts((current) =>
        current.map((item) =>
          item.id === parsed.data.host.id ? parsed.data.host : item,
        ),
      );
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="hosts-heading" className="space-y-4">
        <div>
          <h2 id="hosts-heading" className="text-xl font-semibold">
            Hosts
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create host workspaces, configure their initial limits, and activate
            or suspend access.
          </p>
        </div>
        {hosts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            No hosts yet. Create the first host below.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {hosts.map((host) => (
              <li
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                key={host.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{host.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
                      {host.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {host.slug} · {host.plan} · up to {host.limits.maxTenants}{" "}
                    tenants · {host.limits.maxCustomDomains} custom domains
                  </p>
                  {host.domains.length > 0 && (
                    <p className="mt-1 break-all text-sm text-slate-500">
                      {host.domains.join(", ")}
                    </p>
                  )}
                  {host.status === "active" && (
                    <HostOwnerInviteForm host={host} />
                  )}
                </div>
                <button
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void updateStatus(
                      host,
                      host.status === "active" ? "suspended" : "active",
                    )
                  }
                  type="button"
                >
                  {host.status === "active" ? "Suspend host" : "Activate host"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-host-heading">
        <h2 id="create-host-heading" className="text-xl font-semibold">
          Create a host
        </h2>
        <form
          className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
          onSubmit={createHost}
        >
          <label className="space-y-1 text-sm font-medium">
            Host name
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="name"
              maxLength={120}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Host slug
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="slug"
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              maxLength={63}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Plan
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="plan"
              defaultValue="starter"
              maxLength={80}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Maximum tenants
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="maxTenants"
              type="number"
              min={0}
              max={1_000_000}
              defaultValue={10}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Maximum custom domains
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="maxCustomDomains"
              type="number"
              min={0}
              max={10_000}
              defaultValue={1}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Support email (optional)
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="supportContact"
              type="email"
              autoComplete="email"
            />
          </label>
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            Domains (optional, comma-separated)
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="domains"
              placeholder="shop.example.com"
            />
          </label>
          {error && (
            <p className="text-sm text-red-700 sm:col-span-2" role="alert">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <button
              className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving…" : "Create host"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
