import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

type TenantDashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantDashboardPage({
  params,
}: TenantDashboardPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getTenantOwnerSession();
  if (!session) {
    redirect(`/${locale}/tenant/login`);
  }
  if (session.scope.kind !== "tenant") {
    redirect(`/${locale}/tenant/login`);
  }
  const { id: tenantId, hostId } = session.scope;

  const store = getPlatformStore();
  const [host, tenants] = await Promise.all([
    store.listHosts(),
    store.listTenantsForHost(hostId),
  ]);
  const tenant = tenants.find(
    (candidate) => candidate.id === tenantId && candidate.hostId === hostId,
  );
  const hostRecord = host.find((candidate) => candidate.id === hostId);
  if (!tenant || !hostRecord) {
    redirect(`/${locale}/tenant/login`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Store portal</p>
          <h1 className="mt-1 text-2xl font-semibold">{tenant.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {session.userId}
          </p>
        </div>
        <form action="/api/tenant/auth/logout" method="post">
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="grid gap-4 py-8 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Store status</p>
          <p className="mt-1 font-semibold capitalize">{tenant.status}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Plan</p>
          <p className="mt-1 font-semibold">{tenant.plan}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Managing host</p>
          <p className="mt-1 font-semibold">{hostRecord.name}</p>
        </div>
      </section>

      <section className="space-y-4 pb-10">
        <h2 className="text-xl font-semibold">Store setup</h2>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h3 className="font-semibold text-amber-950">
            Storefront provisioning is the next platform step
          </h3>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            This portal currently shows your store record and access status.
            Backend connection, catalog, payments, storage, storefront themes,
            and domain setup are not available yet. No tenant backend
            credentials are stored or requested here.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-medium">Assigned domains</h3>
          {tenant.domains.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-slate-600">
              {tenant.domains.map((domain) => (
                <li className="break-all" key={domain}>
                  {domain}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No custom domains have been assigned by your host yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
