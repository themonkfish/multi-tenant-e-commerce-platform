export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { TenantStoreSettingsForm } from "@/features/tenant-auth/tenant-store-settings-form";
import { TenantRestConnectionForm } from "@/features/tenant-auth/tenant-rest-connection-form";
import { TenantDatabaseProviderForm } from "@/features/tenant-auth/tenant-database-provider-form";
import { TenantStorageProviderForm } from "@/features/tenant-auth/tenant-storage-provider-form";
import { TenantLogisticsProviderForm } from "@/features/tenant-auth/tenant-logistics-provider-form";
import { TenantRazorpaySettingsForm } from "@/features/tenant-auth/tenant-razorpay-settings-form";
import { TenantDataExport } from "@/features/tenant-auth/tenant-data-export";
import {
  TenantDatabaseConnectionViewSchema,
  TenantStorageConnectionViewSchema,
  TenantLogisticsConnectionViewSchema,
  getTenantProvisioningReadiness,
} from "@/core/domain/tenant-config";
import { TenantStaffManagement } from "@/features/tenant-auth/tenant-staff-management";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";
import { getStripeConfiguration } from "@/lib/server/stripe-payments";
import { summarizeTenantOrders } from "@/features/tenants/tenant-order-report";

type TenantDashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantDashboardPage({
  params,
}: TenantDashboardPageProps) {
  await connection();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "TenantSettings" });
  const staffT = await getTranslations({ locale, namespace: "TenantStaff" });
  const setupT = await getTranslations({ locale, namespace: "TenantSetup" });
  const portalT = await getTranslations({ locale, namespace: "TenantPortal" });
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
  const [settings, restConnection, databaseProvider, storageProvider, orders] =
    await Promise.all([
      store.getTenantStoreSettings(tenant.id, hostId, tenant.name),
      store.getTenantRestConnection(tenant.id, hostId),
      store.getTenantDatabaseProvider(tenant.id, hostId),
      store.getTenantStorageProvider(tenant.id, hostId),
      store.listTenantOrders(tenant.id),
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
  const storageConnection = storageProvider
    ? storageProvider.type === "supabase"
      ? TenantStorageConnectionViewSchema.parse({
          type: "supabase",
          projectUrl: storageProvider.projectUrl,
          bucket: storageProvider.bucket,
          credentialsConfigured: true,
        })
      : storageProvider.type === "gcs"
        ? TenantStorageConnectionViewSchema.parse({
            type: "gcs",
            bucket: storageProvider.bucket,
            publicBaseUrl: storageProvider.publicBaseUrl,
            credentialsConfigured: true,
          })
      : storageProvider.type === "azure"
        ? TenantStorageConnectionViewSchema.parse({
            type: "azure",
            accountName: storageProvider.accountName,
            container: storageProvider.container,
            publicBaseUrl: storageProvider.publicBaseUrl,
            credentialsConfigured: true,
          })
      : storageProvider.type === "cloudinary"
        ? TenantStorageConnectionViewSchema.parse({
            type: "cloudinary",
            cloudName: storageProvider.cloudName,
            credentialsConfigured: true,
          })
      : storageProvider.type === "gdrive"
        ? TenantStorageConnectionViewSchema.parse({
            type: "gdrive",
            folderId: storageProvider.folderId,
            accountEmail: storageProvider.accountEmail,
            credentialsConfigured: true,
          })
      : storageProvider.type === "dropbox"
        ? TenantStorageConnectionViewSchema.parse({
            type: "dropbox",
            folderId: storageProvider.folderId,
            accountEmail: storageProvider.accountEmail,
            credentialsConfigured: true,
          })
      : storageProvider.type === "onedrive"
        ? TenantStorageConnectionViewSchema.parse({
            type: "onedrive",
            folderId: storageProvider.folderId,
            accountEmail: storageProvider.accountEmail,
            credentialsConfigured: true,
          })
        : TenantStorageConnectionViewSchema.parse({
            type: "s3",
            endpoint: storageProvider.endpoint,
            region: storageProvider.region,
            bucket: storageProvider.bucket,
            publicBaseUrl: storageProvider.publicBaseUrl,
            pathStyle: storageProvider.pathStyle,
            credentialsConfigured: true,
          })
    : null;
  const logisticsConnection = settings.shipping.logistics
    ? settings.shipping.logistics.type === "shiprocket"
      ? TenantLogisticsConnectionViewSchema.parse({
          type: "shiprocket",
          apiEmail: settings.shipping.logistics.apiEmail,
          pickupLocation: settings.shipping.logistics.pickupLocation,
          credentialsConfigured: true,
        })
      : TenantLogisticsConnectionViewSchema.parse({
          type: "bluedart",
          baseUrl: settings.shipping.logistics.baseUrl,
          customerCode: settings.shipping.logistics.customerCode,
          loginId: settings.shipping.logistics.loginId,
          credentialsConfigured: true,
        })
    : null;
  const staff = await store.listTenantStaff(tenant.id);
  let stripeConfigured = false;
  try {
    getStripeConfiguration();
    stripeConfigured = true;
  } catch {
    stripeConfigured = false;
  }
  const readiness = getTenantProvisioningReadiness({
    restConfigured: Boolean(restConnection),
    databaseConfigured: Boolean(databaseProvider),
    storageConfigured: Boolean(storageProvider),
    stripeConfigured,
    stripeEnabled: settings.payments.stripe,
    cashOnDeliveryEnabled: settings.payments.cashOnDelivery,
    staffCount: staff.length,
    customDomainCount: tenant.domains.length,
  });
  const orderReport = summarizeTenantOrders(orders);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            {portalT("storePortal")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {settings.branding.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {portalT("signedInAs", { userId: session.userId })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/tenant/export" method="post">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
              type="submit"
            >
              {portalT("exportTenantData")}
            </button>
          </form>
          <form action="/api/tenant/auth/logout" method="post">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
              type="submit"
            >
              {portalT("signOut")}
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-4 py-8 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{portalT("storeStatus")}</p>
          <p className="mt-1 font-semibold capitalize">{tenant.status}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{portalT("plan")}</p>
          <p className="mt-1 font-semibold">{tenant.plan}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{portalT("managingHost")}</p>
          <p className="mt-1 font-semibold">{hostRecord.name}</p>
        </div>
        {orderReport.topProducts.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700">
              {portalT("reportTopProducts")}
            </p>
            <ul className="mt-2 divide-y rounded-md border border-slate-100 text-sm">
              {orderReport.topProducts.map((product) => (
                <li
                  className="flex items-center justify-between gap-4 px-3 py-2"
                  key={product.productId}
                >
                  <span>
                    {product.title} · {product.units} {portalT("reportUnits")}
                  </span>
                  <span className="font-medium">
                    {product.revenueMinor.toLocaleString("en")}{" "}
                    {settings.locale.currency}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-4 pb-10">
        <h2 className="text-xl font-semibold">{t("sectionTitle")}</h2>
        <p className="text-sm text-slate-600">{t("sectionDescription")}</p>
        <TenantStoreSettingsForm initialSettings={settings} />
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {portalT("provisioningTitle")}
            </h2>
            <span
              className={
                readiness.ready
                  ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
                  : "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900"
              }
            >
              {readiness.ready
                ? portalT("provisioningReady")
                : portalT("provisioningIncomplete")}
            </span>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {readiness.items.map((item) => (
              <li
                className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm"
                key={item.key}
              >
                <span>
                  {item.key === "catalog"
                    ? portalT("readinessCatalog")
                    : item.key === "payments"
                      ? portalT("readinessPayments")
                      : item.key === "storage"
                        ? portalT("readinessStorage")
                        : item.key === "staff"
                          ? portalT("readinessStaff")
                          : portalT("readinessCustomDomain")}
                </span>
                <span
                  className={
                    item.configured
                      ? "font-medium text-emerald-700"
                      : "text-slate-500"
                  }
                >
                  {item.configured
                    ? portalT("readinessConfigured")
                    : portalT("readinessNotConfigured")}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">
            {portalT("orderReportTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {portalT("orderReportDescription")}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportOrders")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.orderCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportGrossSales")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.grossSalesMinor.toLocaleString("en")}{" "}
                {settings.locale.currency}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportAverageOrder")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.averageOrderMinor.toLocaleString("en")}{" "}
                {settings.locale.currency}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportUnitsSold")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.unitsSold}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">{portalT("reportPaid")}</p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.paidCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportCodDue")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.codDueCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportRefunded")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.refundedCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportCancelled")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.cancelledCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportShipped")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.shippedCount}
              </p>
            </article>
            <article className="rounded-md border border-slate-100 p-3">
              <p className="text-sm text-slate-500">
                {portalT("reportDelivered")}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {orderReport.deliveredCount}
              </p>
            </article>
          </div>
        </section>
        <h2 className="pt-4 text-xl font-semibold">{staffT("teamAccess")}</h2>
        <TenantStaffManagement initialStaff={staff} />
        <h2 className="pt-4 text-xl font-semibold">{setupT("storeSetup")}</h2>
        <div>
          <h3 className="mb-2 font-semibold">{setupT("restConnection")}</h3>
          <p className="mb-4 text-sm text-slate-600">
            {setupT("restConnectionDescription")}
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
          <h3 className="mb-2 font-semibold">{setupT("databaseConnection")}</h3>
          <p className="mb-4 text-sm text-slate-600">
            {setupT("databaseConnectionDescription")}
          </p>
          <TenantDatabaseProviderForm initialConnection={databaseConnection} />
        </div>
        <div>
          <h3 className="mb-2 font-semibold">{setupT("storageConnection")}</h3>
          <p className="mb-4 text-sm text-slate-600">
            {setupT("storageConnectionDescription")}
          </p>
          <TenantStorageProviderForm initialConnection={storageConnection} />
        </div>
        <div>
          <TenantLogisticsProviderForm
            initialConnection={logisticsConnection}
          />
        </div>
        <div>
          <TenantRazorpaySettingsForm
            initialConnection={
              settings.payments.razorpayConfig
                ? {
                    keyId: settings.payments.razorpayConfig.keyId,
                    credentialsConfigured: true,
                  }
                : null
            }
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-2 font-semibold">{portalT("catalogManagement")}</h3>
          <p className="mb-4 text-sm text-slate-600">
            {portalT("catalogManagementDescription")}
          </p>
          <a
            className="inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            href={`/${locale}/tenant/products`}
          >
            {portalT("openProductManager")}
          </a>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-2 font-semibold">{portalT("orderManagement")}</h3>
          <p className="mb-4 text-sm text-slate-600">
            {portalT("orderManagementDescription")}
          </p>
          <a
            className="inline-flex rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            href={`/${locale}/tenant/orders`}
          >
            {portalT("openOrderManager")}
          </a>
        </div>
        <TenantDataExport />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm leading-6 text-amber-900">
            {portalT("futureWorkNotice")}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-medium">{portalT("assignedDomains")}</h3>
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
              {portalT("noAssignedDomains")}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
