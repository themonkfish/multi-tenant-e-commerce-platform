import type { HostConfig } from "@/core/domain/host-config";
import type { TenantRecord } from "@/core/domain/host-portal";

export function PlatformBillingSummary({
  hosts,
  tenants,
}: {
  hosts: HostConfig[];
  tenants: TenantRecord[];
}) {
  return (
    <section aria-labelledby="platform-billing-heading" className="space-y-4">
      <div>
        <h2 id="platform-billing-heading" className="text-xl font-semibold">
          Plans and usage
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Current host plan assignments and configured tenancy/domain limits.
          Live invoicing and billing-provider integration are not configured.
        </p>
      </div>
      {hosts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          No host plans assigned.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Host
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Plan
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Tenants
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Custom domains
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hosts.map((host) => {
                const tenantCount = tenants.filter(
                  (tenant) => tenant.hostId === host.id,
                ).length;
                return (
                  <tr key={host.id}>
                    <td className="px-4 py-3 font-medium">{host.name}</td>
                    <td className="px-4 py-3 text-slate-600">{host.plan}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {tenantCount} / {host.limits.maxTenants}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {host.domains.length} / {host.limits.maxCustomDomains}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
                        {host.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
