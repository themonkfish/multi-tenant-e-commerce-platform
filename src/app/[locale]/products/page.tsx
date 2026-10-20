import Link from "next/link";
import { notFound } from "next/navigation";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";

type CataloguePageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantProductCatalogPage({
  params,
}: CataloguePageProps) {
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

  let products: Array<{
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
    const result = await catalog.listProducts({
      tenantId: requestScope.tenant.id,
      page: 1,
      limit: 24,
    });
    products = result.data.filter((product) => product.status === "active");
  } catch {
    products = [];
  }

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10"
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
              Store catalog
            </p>
            <h1 className="text-2xl font-semibold text-slate-950">
              {settings.branding.name}
            </h1>
          </div>
        </div>
        <Link
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          href={`/${locale}`}
        >
          Return home
        </Link>
      </header>

      {products.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-lg font-medium text-slate-900">
            No active products are available yet.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            The tenant backend is connected, but the catalog is empty or not yet
            published.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              key={product.id}
            >
              <div
                className="flex h-28 items-center justify-center text-2xl font-semibold text-white"
                style={{ backgroundColor: settings.branding.primaryColor }}
              >
                {product.title.charAt(0).toUpperCase()}
              </div>
              <div className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {product.title}
                    </h2>
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

                <p className="text-sm text-slate-600">
                  {product.sku
                    ? `SKU: ${product.sku}`
                    : "Ready for storefront display"}
                </p>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xl font-semibold text-slate-900">
                    {product.price.amount} {product.price.currency}
                  </span>
                  <Link
                    className="rounded-md px-3 py-2 text-sm font-medium text-white"
                    href={`/${locale}/products/${product.slug}`}
                    style={{ backgroundColor: settings.branding.primaryColor }}
                  >
                    View item
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
