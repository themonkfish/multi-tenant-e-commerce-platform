export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TenantStoreSettingsForm } from "@/features/tenant-auth/tenant-store-settings-form";
import { TenantRestConnectionForm } from "@/features/tenant-auth/tenant-rest-connection-form";
import { TenantDatabaseProviderForm } from "@/features/tenant-auth/tenant-database-provider-form";
import { TenantDatabaseConnectionViewSchema } from "@/core/domain/tenant-config";
import { TenantStaffManagement } from "@/features/tenant-auth/tenant-staff-management";
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
  const [settings, restConnection, databaseProvider] = await Promise.all([
    store.getTenantStoreSettings(tenant.id, hostId, tenant.name),
    store.getTenantRestConnection(tenant.id, hostId),
    store.getTenantDatabaseProvider(tenant.id, hostId),
  ]);
  const databaseConnection = databaseProvider
    ? TenantDatabaseConnectionViewSchema.parse(
        databaseProvider.type === "supabase"
          ? {
              type: "supabase",
              projectUrl: databaseProvider.projectUrl,
              schema: databaseProvider.schema,
              tenancyMode: databaseProvider.tenancyMode,
              credentialConfigured: true,
              schemaVersion: null,
            }
          : {
              type: "mongodb",
              dbName: databaseProvider.dbName,
              tenancyMode: databaseProvider.tenancyMode,
              credentialConfigured: true,
              schemaVersion: null,
            },
      )
    : null;
  const staff = await store.listTenantStaff(tenant.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Store portal</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {settings.branding.name}
          </h1>
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
        <h2 className="text-xl font-semibold">Brand and localization</h2>
        <p className="text-sm text-slate-600">
          Configure your store identity and supported display locales. These
          settings are saved within your tenant scope.
        </p>
        <TenantStoreSettingsForm initialSettings={settings} />
        <h2 className="pt-4 text-xl font-semibold">Team access</h2>
        <TenantStaffManagement initialStaff={staff} />
        <h2 className="pt-4 text-xl font-semibold">Store setup</h2>
        <div>
          <h3 className="mb-2 font-semibold">REST backend connection</h3>
          <p className="mb-4 text-sm text-slate-600">
            Connect an HTTPS API that implements the platform REST contract.
            Connection tests are rate-limited and block private or internal IP
            addresses.
          </p>
          <TenantRestConnectionForm
            initialConnection={{
              baseUrl: restConnection?.baseUrl ?? "",
              apiVersion: restConnection?.apiVersion ?? "v1",
              apiKeyConfigured: Boolean(restConnection),
            }}
          />
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Supabase or MongoDB connection</h3>
          <p className="mb-4 text-sm text-slate-600">
            Configure a dedicated tenant Supabase project or MongoDB Atlas
            database. Database credentials are stored in the encrypted vault.
            When configured, the database provider is used for catalog access
            instead of the REST backend.
          </p>
          <TenantDatabaseProviderForm initialConnection={databaseConnection} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-2 font-semibold">Catalog management</h3>
          <p className="mb-4 text-sm text-slate-600">
            Use the product catalog to create and maintain the catalog in the
            active tenant data provider.
          </p>
          <a
            className="inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            href={`/${locale}/tenant/products`}
          >
            Open product manager
          </a>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-2 font-semibold">Order management</h3>
          <p className="mb-4 text-sm text-slate-600">
            Review orders received by the connected backend and update basic
            processing status.
          </p>
          <a
            className="inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            href={`/${locale}/tenant/orders`}
          >
            Open order manager
          </a>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm leading-6 text-amber-900">
            Payments, storage, storefront rendering, and custom-domain routing
            are not available yet.
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
