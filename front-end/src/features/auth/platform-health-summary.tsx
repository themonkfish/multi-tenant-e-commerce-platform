import Link from "next/link";

export function PlatformHealthSummary({
  setupComplete,
  hostCount,
  tenantCount,
  activeHostCount,
  activeTenantCount,
}: {
  setupComplete: boolean;
  hostCount: number;
  tenantCount: number;
  activeHostCount: number;
  activeTenantCount: number;
}) {
  const healthy = setupComplete;

  return (
    <section aria-labelledby="platform-health-heading" className="space-y-4">
      <div>
        <h2 id="platform-health-heading" className="text-xl font-semibold">
          Platform health
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Current platform-store setup and tenancy summary.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Platform store</p>
          <p
            className={`mt-1 font-semibold ${
              healthy ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {healthy ? "Configured" : "Setup incomplete"}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Hosts</p>
          <p className="mt-1 font-semibold">
            {activeHostCount} active / {hostCount} total
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Tenants</p>
          <p className="mt-1 font-semibold">
            {activeTenantCount} active / {tenantCount} total
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Public health</p>
          <Link
            className="mt-1 block font-semibold text-indigo-700 hover:underline"
            href="/api/health"
          >
            View health JSON
          </Link>
        </article>
      </div>
    </section>
  );
}
