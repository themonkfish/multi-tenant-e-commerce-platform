"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  TenantRecordSchema,
  type TenantRecord,
  type TenantStatus,
} from "@/core/domain/host-portal";

const TenantResponseSchema = z.object({ tenant: TenantRecordSchema });

function errorCode(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body
    ? body.error
    : undefined;
}

function describeTenantError(code: unknown): string {
  if (code === "tenant_limit_reached") {
    return "Your host has reached its tenant limit.";
  }
  if (code === "custom_domain_limit_reached") {
    return "Your host has reached its custom-domain limit.";
  }
  if (code === "tenant_slug_or_domain_in_use") {
    return "That tenant slug or domain is already in use.";
  }
  if (code === "invalid_tenant_domain") {
    return "Enter domains as hostnames only, such as store.example.com.";
  }
  if (code === "rate_limited") {
    return "Too many changes. Wait a few minutes and try again.";
  }
  return "The request could not be completed. Please try again.";
}

export function HostTenantManagement({
  initialTenants,
  maxTenants,
  maxCustomDomains,
  hostDomainsUsed,
}: {
  initialTenants: TenantRecord[];
  maxTenants: number;
  maxCustomDomains: number;
  hostDomainsUsed: number;
}) {
  const [tenants, setTenants] = useState(initialTenants);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const domainsUsed =
    hostDomainsUsed +
    tenants.reduce((total, tenant) => total + tenant.domains.length, 0);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/host/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug"),
          plan: form.get("plan"),
          domains: String(form.get("domains") ?? "")
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeTenantError(errorCode(body)));
        return;
      }
      const parsed = TenantResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid tenant record.");
        return;
      }
      setTenants((current) =>
        [...current, parsed.data.tenant].sort((a, b) =>
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

  async function updateStatus(tenant: TenantRecord, status: TenantStatus) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/host/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeTenantError(errorCode(body)));
        return;
      }
      const parsed = TenantResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid tenant record.");
        return;
      }
      setTenants((current) =>
        current.map((item) =>
          item.id === parsed.data.tenant.id ? parsed.data.tenant : item,
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
      <section aria-labelledby="tenant-list-heading" className="space-y-4">
        <div>
          <h2 id="tenant-list-heading" className="text-xl font-semibold">
            Tenants
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {tenants.length} of {maxTenants} tenants · {domainsUsed} of{" "}
            {maxCustomDomains} custom domains used
          </p>
        </div>
        {tenants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            No tenants yet. Create the first tenant below.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {tenants.map((tenant) => (
              <li
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                key={tenant.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{tenant.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
                      {tenant.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {tenant.slug} · {tenant.plan}
                  </p>
                  {tenant.domains.length > 0 && (
                    <p className="mt-1 break-all text-sm text-slate-500">
                      {tenant.domains.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void updateStatus(
                      tenant,
                      tenant.status === "active" ? "suspended" : "active",
                    )
                  }
                  type="button"
                >
                  {tenant.status === "active"
                    ? "Suspend tenant"
                    : "Activate tenant"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-tenant-heading">
        <h2 id="create-tenant-heading" className="text-xl font-semibold">
          Create a tenant
        </h2>
        <form
          className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
          onSubmit={createTenant}
        >
          <label className="space-y-1 text-sm font-medium">
            Store name
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="name"
              maxLength={120}
              required
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Tenant slug
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
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            Custom domains (optional, comma-separated)
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              name="domains"
              placeholder="store.example.com"
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
              {busy ? "Saving…" : "Create tenant"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
