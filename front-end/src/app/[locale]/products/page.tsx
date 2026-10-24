import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { formatCurrencyAmount } from "@/core/domain/money";
import {
  StorefrontAddToCartButton,
  StorefrontCartButton,
} from "@/features/storefront/cart-button";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";

type CataloguePageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TenantProductCatalogPage({
  params,
  searchParams,
}: CataloguePageProps) {
  const { locale } = await params;
  const filters = await searchParams;
  const value = (entry: string | string[] | undefined) =>
    (Array.isArray(entry) ? entry[0] : entry)?.trim() ?? "";
  const search = value(filters.search).slice(0, 100);
  const category = value(filters.category).slice(0, 80);
  const requestedPage = Number(value(filters.page) || "1");
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
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
    category?: string | null;
    imageUrl?: string | null;
  }> = [];
  let categories: string[] = [];
  let total = 0;
  let pageCount = 1;
  let currentPage = page;
  try {
    const catalog = await createTenantCatalogAdapter(
      requestScope.tenant.id,
      requestScope.host.id,
    );
    let result = await catalog.listProducts({
      tenantId: requestScope.tenant.id,
      page,
      limit: 24,
      status: "active",
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
    });
    pageCount = Math.max(1, Math.ceil(result.meta.total / result.meta.limit));
    if (page > pageCount) {
      currentPage = pageCount;
      result = await catalog.listProducts({
        tenantId: requestScope.tenant.id,
        page: currentPage,
        limit: 24,
        status: "active",
        ...(search ? { search } : {}),
        ...(category ? { category } : {}),
      });
    }
    products = result.data.filter((product) => product.status === "active");
    total = result.meta.total;
    try {
      categories = await catalog.listProductCategories(
        requestScope.tenant.id,
        "active",
      );
    } catch (error) {
      console.error("Storefront category lookup failed", {
        tenantId: requestScope.tenant.id,
        error: error instanceof Error ? error.message : String(error),
      });
      categories = Array.from(
        new Set(
          products.flatMap((product) =>
            product.category ? [product.category] : [],
          ),
        ),
      ).sort((left, right) => left.localeCompare(right));
    }
  } catch {
    products = [];
  }
  const categoryHref = (nextCategory?: string, nextPage?: number) => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (nextCategory) query.set("category", nextCategory);
    if (nextPage && nextPage > 1) query.set("page", String(nextPage));
    const queryString = query.toString();
    const suffix = queryString ? `?${queryString}` : "";
    return `/${locale}/products${suffix}`;
  };

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
        <div className="flex flex-wrap gap-3">
          <StorefrontCartButton locale={locale} />
          <Link
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            href={`/${locale}`}
          >
            Return home
          </Link>
        </div>
      </header>

      <section className="mb-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <form
          action={`/${locale}/products`}
          className="flex flex-col gap-3 sm:flex-row"
          role="search"
        >
          <label className="sr-only" htmlFor="product-search">
            Search products
          </label>
          <input
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2"
            defaultValue={search}
            id="product-search"
            maxLength={100}
            name="search"
            placeholder="Search product names"
            type="search"
          />
          {category && <input name="category" type="hidden" value={category} />}
          <button
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: settings.branding.primaryColor }}
            type="submit"
          >
            Search
          </button>
          {(search || category) && (
            <Link
              className="rounded-md border border-slate-300 px-4 py-2 text-center text-sm font-medium hover:bg-slate-50"
              href={`/${locale}/products`}
            >
              Clear filters
            </Link>
          )}
        </form>
        {categories.length > 0 && (
          <nav aria-label="Product categories" className="flex flex-wrap gap-2">
            <Link
              aria-current={category ? undefined : "page"}
              className={`rounded-full border px-3 py-1.5 text-sm ${!category ? "border-indigo-700 bg-indigo-50 font-semibold text-indigo-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
              href={categoryHref()}
            >
              All categories
            </Link>
            {categories.map((item) => (
              <Link
                aria-current={category === item ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm ${category === item ? "border-indigo-700 bg-indigo-50 font-semibold text-indigo-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                href={categoryHref(item)}
                key={item}
              >
                {item}
              </Link>
            ))}
          </nav>
        )}
        <p className="text-sm text-slate-600">
          {total} product{total === 1 ? "" : "s"}
          {search ? ` matching “${search}”` : ""}
          {category ? ` in ${category}` : ""}
        </p>
      </section>

      {products.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-lg font-medium text-slate-900">
            {search || category
              ? "No products match these filters."
              : "No active products are available yet."}
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
              {product.imageUrl ? (
                <Image
                  alt={product.title}
                  className="h-28 w-full object-cover"
                  src={product.imageUrl}
                  width={640}
                  height={224}
                  unoptimized
                />
              ) : (
                <div
                  className="flex h-28 items-center justify-center text-2xl font-semibold text-white"
                  style={{ backgroundColor: settings.branding.primaryColor }}
                >
                  {product.title.charAt(0).toUpperCase()}
                </div>
              )}
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
                {product.category && (
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {product.category}
                  </span>
                )}

                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-xl font-semibold text-slate-900">
                    {formatCurrencyAmount(
                      product.price.amount,
                      product.price.currency,
                      locale,
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <StorefrontAddToCartButton
                      item={{
                        id: product.id,
                        slug: product.slug,
                        title: product.title,
                        price: product.price.amount,
                        currency: product.price.currency,
                      }}
                      locale={locale}
                    />
                    <Link
                      className="rounded-md px-3 py-2 text-sm font-medium text-white"
                      href={`/${locale}/products/${product.slug}`}
                      style={{
                        backgroundColor: settings.branding.primaryColor,
                      }}
                    >
                      View item
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {pageCount > 1 && (
        <nav
          aria-label="Product pages"
          className="mt-6 flex items-center justify-between"
        >
          {currentPage > 1 ? (
            <Link
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              href={categoryHref(category || undefined, currentPage - 1)}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-slate-600">
            Page {currentPage} of {pageCount}
          </span>
          {currentPage < pageCount ? (
            <Link
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              href={categoryHref(category || undefined, currentPage + 1)}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
