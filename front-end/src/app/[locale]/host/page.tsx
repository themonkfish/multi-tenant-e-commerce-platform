export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { HostTenantManagement } from "@/features/tenants/host-tenant-management";
import { getPlatformStore } from "@/lib/server/platform";
import { getHostOwnerSession } from "@/lib/server/session";

type HostPortalPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function HostPortalPage({ params }: HostPortalPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getHostOwnerSession();
  if (!session || session.scope.kind !== "host") {
    redirect(`/${locale}/host/login`);
  }

  const store = getPlatformStore();
  const host = (await store.listHosts()).find(
    (candidate) => candidate.id === session.scope.id,
  );
  if (!host || host.status !== "active") {
    redirect(`/${locale}/host/login`);
  }
  const tenants = await store.listTenantsForHost(host.id);
  const [domainClaims, setupState] = await Promise.all([
    store.listTenantDomainClaims(host.id),
    store.getSetupState(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Host portal</p>
          <h1 className="mt-1 text-2xl font-semibold">{host.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {session.userId}
          </p>
        </div>
        <form action="/api/host/auth/logout" method="post">
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>
      <section className="py-10">
        <HostTenantManagement
          initialTenants={tenants}
          initialDomainClaims={domainClaims}
          platformDomain={setupState.platformDomain ?? ""}
          maxTenants={host.limits.maxTenants}
          maxCustomDomains={host.limits.maxCustomDomains}
          hostDomainsUsed={host.domains.length}
        />
      </section>
    </main>
  );
}
