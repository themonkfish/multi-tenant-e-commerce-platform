import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  const t = await getTranslations("Home");
  const requestScope = await getRequestDomainScope();

  if (requestScope?.kind === "unavailable") {
    notFound();
  }

  if (requestScope?.kind === "tenant") {
    const settings = await getPlatformStore().getTenantStoreSettings(
      requestScope.tenant.id,
      requestScope.host.id,
      requestScope.tenant.name,
    );

    let catalogProducts: Array<{
      id: string;
      title: string;
      slug: string;
      status: "draft" | "active" | "archived";
      price: { amount: number; currency: string };
      sku?: string;
    }> = [];

    try {
      const catalog = await createTenantCatalogAdapter(
        requestScope.tenant.id,
        requestScope.host.id,
      );
      const page = await catalog.listProducts({
        tenantId: requestScope.tenant.id,
        page: 1,
        limit: 6,
      });
      catalogProducts = page.data.filter(
        (product) => product.status === "active",
      );
    } catch {
      catalogProducts = [];
    }

    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-8 sm:px-10"
        style={{
          background: `linear-gradient(180deg, ${settings.branding.primaryColor}10 0%, #ffffff 28%, #ffffff 100%)`,
        }}
      >
        <div
          className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60"
          style={{
            borderColor: `${settings.branding.primaryColor}33`,
          }}
        >
          <header
            className="flex flex-col gap-4 border-b px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
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
                  Tenant storefront
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {settings.branding.name}
                </h1>
              </div>
            </div>
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: `${settings.branding.accentColor}14`,
                color: settings.branding.accentColor,
              }}
            >
              {settings.locale.defaultLocale}
            </span>
          </header>

          <section className="grid gap-6 px-6 py-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p
                className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
                style={{
                  backgroundColor: `${settings.branding.primaryColor}12`,
                  color: settings.branding.primaryColor,
                }}
              >
                Storefront preview
              </p>
              <h2 className="text-4xl font-semibold tracking-tight text-slate-950">
                {catalogProducts.length > 0
                  ? "Featured catalog"
                  : t("storefrontUnavailable")}
              </h2>
              <p className="mt-4 max-w-xl text-lg leading-8 text-slate-600">
                {catalogProducts.length > 0
                  ? `A live catalog preview is available for ${settings.branding.name}.`
                  : settings.branding.description ||
                    "This tenant storefront is configured and ready for future catalog, cart, and checkout flows."}
              </p>
            </div>

            <aside
              className="rounded-xl border p-5"
              style={{
                backgroundColor: `${settings.branding.primaryColor}08`,
                borderColor: `${settings.branding.primaryColor}22`,
              }}
            >
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Store identity
              </p>
              <dl className="mt-4 space-y-4 text-sm text-slate-700">
                <div>
                  <dt className="font-medium text-slate-500">Default locale</dt>
                  <dd className="mt-1 text-slate-900">
                    {settings.locale.defaultLocale}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Currency</dt>
                  <dd className="mt-1 text-slate-900">
                    {settings.locale.currency}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">
                    Supported locales
                  </dt>
                  <dd className="mt-1 text-slate-900">
                    {settings.locale.locales.join(", ")}
                  </dd>
                </div>
              </dl>
              <Link
                className="mt-5 inline-flex rounded-md px-3 py-2 text-sm font-medium text-white"
                href={`/${locale}/products`}
                style={{ backgroundColor: settings.branding.primaryColor }}
              >
                Browse catalog
              </Link>
            </aside>
          </section>

          {catalogProducts.length > 0 && (
            <section className="border-t border-slate-200 bg-slate-50 px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">
                  Featured products
                </h3>
                <span className="text-sm text-slate-500">
                  {catalogProducts.length} items
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {catalogProducts.map((product) => (
                  <article
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    key={product.id}
                  >
                    <div
                      className="mb-4 flex h-28 items-center justify-center rounded-lg text-lg font-semibold text-white"
                      style={{
                        backgroundColor: settings.branding.primaryColor,
                      }}
                    >
                      {product.title.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-slate-900">
                          {product.title}
                        </h4>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {product.slug}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                        style={{
                          backgroundColor: `${settings.branding.accentColor}14`,
                          color: settings.branding.accentColor,
                        }}
                      >
                        {product.status}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2 text-sm text-slate-700">
                      <span>
                        {product.price.amount} {product.price.currency}
                      </span>
                      {product.sku && <span>SKU: {product.sku}</span>}
                    </div>
                    <Link
                      className="mt-4 inline-flex rounded-md px-3 py-2 text-sm font-medium text-white"
                      href={`/${locale}/products/${product.slug}`}
                      style={{
                        backgroundColor: settings.branding.primaryColor,
                      }}
                    >
                      View item
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    );
  }

  if (requestScope?.kind === "host") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-8 sm:px-10">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
          {requestScope.host.branding.name}
        </h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          {t("hostPortal")}
        </p>
        <Link className="mt-6 text-indigo-700 underline" href="/host">
          {t("hostPortalLink")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-5">
        <Link
          className="font-semibold tracking-tight text-slate-950"
          href="/"
          aria-label={t("platformName")}
        >
          {t("platformName")}
        </Link>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
          {t("phase")}
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center py-20">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
          {t("eyebrow")}
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          {t("headline")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          {t("description")}
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {(["storefront", "tenant", "host"] as const).map((area) => (
            <article
              className="rounded-xl border border-slate-200 bg-white p-5"
              key={area}
            >
              <h2 className="font-semibold text-slate-900">
                {t(`${area}Title`)}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {t(`${area}Description`)}
              </p>
            </article>
          ))}
        </div>
      </section>
      <footer className="border-t border-slate-200 py-5 text-sm text-slate-500">
        {t("footer")}
      </footer>
    </main>
  );
}
