import type { HostConfig } from "@/core/domain/host-config";
import type {
  TenantDomainClaim,
  TenantRecord,
} from "@/core/domain/host-portal";
import { useTranslations } from "next-intl";

export function PlatformDomainInventory({
  hosts,
  tenants,
  tenantClaims,
  platformDomain,
}: {
  hosts: HostConfig[];
  tenants: TenantRecord[];
  tenantClaims: TenantDomainClaim[];
  platformDomain?: string;
}) {
  const t = useTranslations("SuperAdminOperations");
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const claimByDomain = new Map(
    tenantClaims.map((claim) => [claim.domain, claim]),
  );
  const hostDomains = hosts.flatMap((host) =>
    host.domains.map((domain) => ({
      domain,
      owner: host.name,
      scope: t("hostScope"),
      status: host.status,
    })),
  );
  const tenantDomains = tenants.flatMap((tenant) =>
    tenant.domains.map((domain) => ({
      domain,
      owner: tenant.name,
      scope: t("tenantScope"),
      status: tenant.status,
    })),
  );
  const claimedTenantDomains = tenantClaims
    .filter(
      (claim) =>
        !tenantById.get(claim.tenantId)?.domains.includes(claim.domain),
    )
    .map((claim) => ({
      domain: claim.domain,
      owner:
        tenantById.get(claim.tenantId)?.name ??
        t("tenantFallback", { id: claim.tenantId.slice(0, 8) }),
      scope: t("tenantClaimScope"),
      status: t("pending"),
    }));
  const rows = [
    ...(platformDomain
      ? [
          {
            domain: platformDomain,
            owner: t("platformOwner"),
            scope: t("platformScope"),
            status: t("active"),
          },
        ]
      : []),
    ...hostDomains,
    ...tenantDomains,
    ...claimedTenantDomains,
  ].sort((left, right) => left.domain.localeCompare(right.domain));

  return (
    <section aria-labelledby="platform-domains-heading" className="space-y-4">
      <div>
        <h2 id="platform-domains-heading" className="text-xl font-semibold">
          {t("domainTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("domainDescription")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          {t("noDomains")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("domain")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("scope")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("owner")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={`${row.scope}-${row.domain}`}>
                  <td className="break-all px-4 py-3 font-mono text-xs">
                    {row.domain}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.scope}</td>
                  <td className="px-4 py-3 text-slate-600">{row.owner}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${
                        row.status === t("active")
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {claimByDomain.has(row.domain) &&
                      row.scope === t("tenantClaimScope")
                        ? t("claimPending")
                        : row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
