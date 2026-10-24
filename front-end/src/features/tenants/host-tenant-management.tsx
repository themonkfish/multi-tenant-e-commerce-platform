"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  TenantDomainClaimSchema,
  TenantRecordSchema,
  type TenantDomainClaim,
  type TenantRecord,
  type TenantStatus,
} from "@/core/domain/host-portal";

const TenantResponseSchema = z.object({ tenant: TenantRecordSchema });
const InviteResponseSchema = z.object({
  inviteUrl: z.url(),
  deliveryStatus: z.enum(["sent", "not_configured", "failed"]),
});
const DomainClaimResponseSchema = z.object({
  claim: TenantDomainClaimSchema,
  dns: z.object({
    cname: z.object({ name: z.string(), value: z.string() }),
    txt: z.object({ name: z.string(), value: z.string() }),
  }),
});
const DomainReadinessResponseSchema = z.object({
  domain: z.string(),
  readiness: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      httpStatus: z.number().int(),
      certificateExpiresAt: z.string().nullable(),
    }),
    z.object({
      status: z.literal("http_error"),
      httpStatus: z.number().int(),
      certificateExpiresAt: z.string().nullable(),
    }),
    z.object({
      status: z.enum([
        "tls_not_ready",
        "unreachable",
        "blocked_target",
        "timeout",
      ]),
    }),
  ]),
});

function errorCode(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body
    ? body.error
    : undefined;
}

function describeTenantError(code: unknown): string {
  if (code === "tenant_owner_already_exists") {
    return "This email already owns a tenant account.";
  }
  if (code === "tenant_must_be_active") {
    return "Activate this tenant before inviting its owner.";
  }
  if (code === "tenant_limit_reached") {
    return "Your host has reached its tenant limit.";
  }
  if (code === "custom_domain_limit_reached") {
    return "Your host has reached its custom-domain limit.";
  }
  if (code === "tenant_slug_or_domain_in_use") {
    return "That tenant slug or domain is already in use.";
  }
  if (code === "tenant_unavailable" || code === "not_found") {
    return "That tenant is unavailable. Refresh the page and try again.";
  }
  if (code === "invalid_tenant_domain") {
    return "Enter domains as hostnames only, such as store.example.com.";
  }
  if (code === "platform_domain_unavailable") {
    return "The platform domain is not configured, so custom domains cannot be provisioned yet.";
  }
  if (code === "domain_dns_not_ready") {
    return "The required DNS records were not found yet. DNS changes may take time to propagate.";
  }
  if (code === "dns_lookup_failed") {
    return "DNS could not be checked right now. Please try again shortly.";
  }
  if (code === "domain_claim_not_found") {
    return "That domain verification is no longer pending. Refresh the page and try again.";
  }
  if (code === "verified_domain_not_found") {
    return "That domain is not verified for this tenant.";
  }
  if (code === "rate_limited") {
    return "Too many changes. Wait a few minutes and try again.";
  }
  return "The request could not be completed. Please try again.";
}

function TenantOwnerInviteControl({ tenant }: { tenant: TenantRecord }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState<
    "sent" | "not_configured" | "failed" | ""
  >("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
      const response = await fetch(`/api/host/tenants/${tenant.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("ownerEmail") }),
      });
      const body: unknown = await response.json();
      const code = errorCode(body);
      if (!response.ok) {
        setError(
          code === "rate_limited"
            ? "Too many invitations. Wait before trying again."
            : describeTenantError(code),
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
        <label className="sr-only" htmlFor={`owner-email-${tenant.id}`}>
          Tenant owner email
        </label>
        <input
          className="min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
          id={`owner-email-${tenant.id}`}
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
          {busy ? "Creating invite…" : "Invite tenant owner"}
        </button>
      </form>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {inviteUrl && (
        <div className="space-y-2 rounded-md bg-indigo-50 p-3">
          <p className="text-sm text-indigo-950">
            {deliveryStatus === "sent"
              ? "Invitation email sent. This one-time fallback link expires in 24 hours."
              : deliveryStatus === "failed"
                ? "Email delivery failed. Share this one-time link securely; it expires in 24 hours."
                : "Email is not configured. Share this one-time link securely; it expires in 24 hours."}
          </p>
          <input
            aria-label="One-time tenant owner invitation link"
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

export function HostTenantManagement({
  initialTenants,
  initialDomainClaims,
  platformDomain,
  maxTenants,
  maxCustomDomains,
  hostDomainsUsed,
}: {
  initialTenants: TenantRecord[];
  initialDomainClaims: TenantDomainClaim[];
  platformDomain: string;
  maxTenants: number;
  maxCustomDomains: number;
  hostDomainsUsed: number;
}) {
  const [tenants, setTenants] = useState(initialTenants);
  const [domainClaims, setDomainClaims] = useState(initialDomainClaims);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const domainsUsed =
    hostDomainsUsed +
    tenants.reduce((total, tenant) => total + tenant.domains.length, 0) +
    domainClaims.length;

  async function addDomain(
    tenantId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/host/tenants/${tenantId}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: form.get("domain") }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(describeTenantError(errorCode(body)));
        return;
      }
      const parsed = DomainClaimResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned invalid domain verification details.");
        return;
      }
      setDomainClaims((current) => [
        ...current.filter((claim) => claim.domain !== parsed.data.claim.domain),
        parsed.data.claim,
      ]);
      formElement.reset();
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain(claim: TenantDomainClaim) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/host/tenants/${claim.tenantId}/domains/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: claim.domain }),
        },
      );
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
        current.map((tenant) =>
          tenant.id === parsed.data.tenant.id ? parsed.data.tenant : tenant,
        ),
      );
      setDomainClaims((current) =>
        current.filter((item) => item.domain !== claim.domain),
      );
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

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
                    <div className="mt-3 space-y-3">
                      <p className="text-sm font-medium text-slate-700">
                        Verified domains
                      </p>
                      {tenant.domains.map((domain) => (
                        <DomainReadinessControl
                          domain={domain}
                          key={domain}
                          tenantId={tenant.id}
                        />
                      ))}
                    </div>
                  )}
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(event) => void addDomain(tenant.id, event)}
                  >
                    <label className="sr-only" htmlFor={`domain-${tenant.id}`}>
                      Custom domain
                    </label>
                    <input
                      className="min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      id={`domain-${tenant.id}`}
                      name="domain"
                      placeholder="store.example.com"
                      required
                    />
                    <button
                      className="rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
                      disabled={busy}
                      type="submit"
                    >
                      Add custom domain
                    </button>
                  </form>
                  {domainClaims
                    .filter((claim) => claim.tenantId === tenant.id)
                    .map((claim) => (
                      <DomainVerificationControl
                        claim={claim}
                        key={claim.domain}
                        busy={busy}
                        platformDomain={platformDomain}
                        onVerify={() => void verifyDomain(claim)}
                      />
                    ))}
                  {tenant.status === "active" && (
                    <TenantOwnerInviteControl tenant={tenant} />
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
          <p className="text-sm text-slate-600 sm:col-span-2">
            Add custom domains after creating the tenant. They become active
            storefront routes only after DNS verification.
          </p>
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

function DomainReadinessControl({
  domain,
  tenantId,
}: {
  domain: string;
  tenantId: string;
}) {
  const [result, setResult] = useState<
    z.infer<typeof DomainReadinessResponseSchema>["readiness"] | null
  >(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkReadiness() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/host/tenants/${tenantId}/domains/readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(
          errorCode(body) === "rate_limited"
            ? "Too many readiness checks. Wait a few minutes and try again."
            : describeTenantError(errorCode(body)),
        );
        return;
      }
      const parsed = DomainReadinessResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("The server returned an invalid readiness result.");
        return;
      }
      setResult(parsed.data.readiness);
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="break-all text-sm font-medium text-slate-800">{domain}</p>
      <p className="mt-1 text-xs text-slate-600">
        Add this hostname to your hosting provider and configure it to serve
        this app. The provider must provision a valid TLS certificate.
      </p>
      <button
        className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
        disabled={busy}
        onClick={() => void checkReadiness()}
        type="button"
      >
        {busy ? "Checking…" : "Check HTTPS and TLS"}
      </button>
      {result && (
        <p
          className={`mt-2 text-sm ${
            result.status === "ready" ? "text-green-800" : "text-amber-800"
          }`}
          role="status"
        >
          {result.status === "ready"
            ? `HTTPS and TLS are working (HTTP ${result.httpStatus}). Certificate expires ${
                result.certificateExpiresAt
                  ? new Date(result.certificateExpiresAt).toLocaleString()
                  : "at an unknown date"
              }.`
            : result.status === "http_error"
              ? `TLS is valid, but the app returned HTTP ${result.httpStatus}. Check the hosting provider's domain routing.`
              : readinessMessage(result.status)}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function readinessMessage(status: string): string {
  if (status === "tls_not_ready") {
    return "The HTTPS endpoint did not present a valid certificate for this domain. Check the hosting provider's domain and certificate settings.";
  }
  if (status === "blocked_target") {
    return "The domain currently resolves to a non-public address, so it was not checked.";
  }
  if (status === "timeout") {
    return "The HTTPS check timed out. Confirm the domain is attached to the hosting provider and try again.";
  }
  return "The HTTPS endpoint could not be reached. Confirm the domain is attached to the hosting provider and DNS is pointing to it.";
}

function DomainVerificationControl({
  claim,
  busy,
  platformDomain,
  onVerify,
}: {
  claim: TenantDomainClaim;
  busy: boolean;
  platformDomain: string;
  onVerify: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-950">
        Verify {claim.domain} by adding these DNS records:
      </p>
      <dl className="grid gap-2 text-amber-950 sm:grid-cols-2">
        <div>
          <dt className="font-medium">CNAME</dt>
          <dd className="break-all font-mono text-xs">
            {claim.domain} -&gt; {platformDomain}
          </dd>
        </div>
        <div>
          <dt className="font-medium">TXT</dt>
          <dd className="break-all font-mono text-xs">
            _platform-verification.{claim.domain}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium">TXT value</dt>
          <dd className="break-all font-mono text-xs">
            platform-verification={claim.verificationToken}
          </dd>
        </div>
      </dl>
      <button
        className="rounded border border-amber-400 px-3 py-1.5 font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
        disabled={busy}
        onClick={onVerify}
        type="button"
      >
        Verify DNS
      </button>
    </div>
  );
}
