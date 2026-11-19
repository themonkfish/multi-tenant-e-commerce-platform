import { redirect } from "next/navigation";
import { connection } from "next/server";
import { HostManagement } from "@/features/hosts/host-management";
import { PlatformAuditLog } from "@/features/auth/platform-audit-log";
import { PlatformSettingsForm } from "@/features/auth/platform-settings-form";
import { PlatformHealthSummary } from "@/features/auth/platform-health-summary";
import { PlatformAnalyticsSummary } from "@/features/auth/platform-analytics-summary";
import { PlatformDomainInventory } from "@/features/auth/platform-domain-inventory";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

type DashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function SuperAdminDashboardPage({
  params,
}: DashboardPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getSuperAdminSession();
  if (!session) {
    redirect(`/${locale}/super-admin/login`);
  }

  const store = getPlatformStore();
  const hosts = await store.listHosts();
  const auditEvents = await store.listAuditEvents({
    scope: session.scope,
    limit: 100,
  });
  const setupState = await store.getSetupState();
  const tenantsByHost = await Promise.all(
    hosts.map((host) => store.listTenantsForHost(host.id)),
  );
  const tenants = tenantsByHost.flat();
  const tenantOrders = await Promise.all(
    tenants.map((tenant) => store.listTenantOrders(tenant.id)),
  );
  const orders = tenantOrders.flat();
  const tenantClaims = (
    await Promise.all(
      hosts.map((host) => store.listTenantDomainClaims(host.id)),
    )
  ).flat();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-5">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            Platform administration
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Super Admin</h1>
        </div>
        <form action="/api/auth/super-admin/logout" method="post">
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>
      <section className="py-10">
        <HostManagement initialHosts={hosts} />
      </section>
      <section className="border-t border-slate-200 py-10">
        <PlatformAuditLog events={auditEvents} />
      </section>
      <section className="border-t border-slate-200 py-10">
        <PlatformSettingsForm initialSettings={setupState.settings} />
      </section>
      <section className="border-t border-slate-200 py-10">
        <PlatformHealthSummary
          setupComplete={setupState.initialized}
          hostCount={hosts.length}
          tenantCount={tenants.length}
          activeHostCount={
            hosts.filter((host) => host.status === "active").length
          }
          activeTenantCount={
            tenants.filter((tenant) => tenant.status === "active").length
          }
        />
      </section>
      <section className="border-t border-slate-200 py-10">
        <PlatformAnalyticsSummary orders={orders} />
      </section>
      <section className="border-t border-slate-200 py-10">
        <PlatformDomainInventory
          hosts={hosts}
          tenants={tenants}
          tenantClaims={tenantClaims}
          platformDomain={setupState.platformDomain}
        />
      </section>
    </main>
  );
}
