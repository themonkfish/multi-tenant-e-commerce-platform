export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { StorefrontCustomerAccount } from "@/features/storefront/customer-account";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import { getCustomerSession } from "@/lib/server/session";

type AccountPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function AccountPage({ params }: AccountPageProps) {
  const { locale } = await params;
  const requestScope = await getRequestDomainScope();

  if (requestScope?.kind !== "tenant") {
    notFound();
  }

  const settings = await getPlatformStore().getTenantStoreSettings(
    requestScope.tenant.id,
    requestScope.host.id,
    requestScope.tenant.name,
  );
  const customerSession = await getCustomerSession();
  const customer = customerSession
    ? await getPlatformStore().getCustomerAccountForTenant(
        requestScope.tenant.id,
        customerSession.userId,
      )
    : null;
  const customerOrders =
    customerSession && customer
      ? await getPlatformStore().listCustomerOrders(
          requestScope.tenant.id,
          customerSession.userId,
        )
      : [];

  return (
    <main
      className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10"
      style={{
        background: `linear-gradient(180deg, ${settings.branding.primaryColor}10 0%, #ffffff 32%, #ffffff 100%)`,
      }}
    >
      <header
        className="mb-8 flex flex-col gap-4 rounded-2xl border px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        style={{
          background: `${settings.branding.primaryColor}12`,
          borderColor: `${settings.branding.primaryColor}22`,
        }}
      >
        <div className="flex items-center gap-3">
          {settings.branding.logoUrl ? (
            <img
              alt={`${settings.branding.name} logo`}
              className="h-12 w-12 rounded-lg object-cover"
              src={settings.branding.logoUrl}
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-semibold text-white"
              style={{ backgroundColor: settings.branding.primaryColor }}
            >
              {settings.branding.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Customer account
            </p>
            <h1 className="text-2xl font-semibold text-slate-950">
              {settings.branding.name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            href={`/${locale}`}
          >
            Store home
          </Link>
          <Link
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            href={`/${locale}/products`}
          >
            Catalog
          </Link>
        </div>
      </header>

      <StorefrontCustomerAccount
        locale={locale}
        customer={
          customer ? { email: customer.email, orders: customerOrders } : null
        }
      />
    </main>
  );
}
