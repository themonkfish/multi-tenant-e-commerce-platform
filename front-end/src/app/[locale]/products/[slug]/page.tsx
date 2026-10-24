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

type ProductDetailPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export default async function TenantProductDetailPage({
  params,
}: ProductDetailPageProps) {
  const { locale, slug } = await params;
  const requestScope = await getRequestDomainScope();

  if (requestScope?.kind !== "tenant") {
    notFound();
  }

  const settings = await getPlatformStore().getTenantStoreSettings(
    requestScope.tenant.id,
    requestScope.host.id,
    requestScope.tenant.name,
  );

  let product: {
    id: string;
    title: string;
    slug: string;
    status: "draft" | "active" | "archived";
    price: { amount: number; currency: string };
    sku?: string;
    imageUrl?: string | null;
  } | null = null;

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
    product =
      result.data.find(
        (candidate) => candidate.slug === slug && candidate.status === "active",
      ) ?? null;
  } catch {
    product = null;
  }

  if (!product) {
    notFound();
  }

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10"
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
              Product detail
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
            href={`/${locale}/products`}
          >
            Back to catalog
          </Link>
          <Link
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            href={`/${locale}`}
          >
            Store home
          </Link>
        </div>
      </header>

      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {product.imageUrl ? (
          <Image
            alt={product.title}
            className="h-64 w-full object-cover sm:h-96"
            src={product.imageUrl}
            width={1280}
            height={768}
            unoptimized
          />
        ) : (
          <div
            className="flex h-40 items-center justify-center text-4xl font-semibold text-white"
            style={{ backgroundColor: settings.branding.primaryColor }}
          >
            {product.title.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="space-y-6 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {product.slug}
              </p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-950">
                {product.title}
              </h2>
            </div>
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: `${settings.branding.accentColor}14`,
                color: settings.branding.accentColor,
              }}
            >
              {product.status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <p className="text-3xl font-semibold text-slate-950">
              {formatCurrencyAmount(
                product.price.amount,
                product.price.currency,
                locale,
              )}
            </p>
            {product.sku && (
              <p className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600">
                SKU: {product.sku}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
              href={`/${locale}/products`}
            >
              Keep shopping
            </Link>
          </div>

          <p className="max-w-2xl text-lg leading-8 text-slate-600">
            Product details are rendered from the tenant’s connected catalog
            backend. This preview includes a cart flow placeholder and a simple
            checkout completion state, while full commerce runtime remains
            future work.
          </p>
        </div>
      </article>
    </main>
  );
}
