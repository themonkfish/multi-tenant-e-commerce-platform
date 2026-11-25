import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";

type CmsPageProps = {
  params: Promise<{ locale: string; pageSlug: string }>;
};

export default async function CmsPage({ params }: CmsPageProps) {
  const { locale, pageSlug } = await params;
  const [requestScope, store] = await Promise.all([
    getRequestDomainScope(),
    Promise.resolve(getPlatformStore()),
  ]);
  if (requestScope?.kind !== "tenant") notFound();

  const settings = await store.getTenantStoreSettings(
    requestScope.tenant.id,
    requestScope.tenant.hostId,
    requestScope.tenant.name,
  );
  const page = (settings.branding.pages ?? []).find(
    (candidate) =>
      candidate.slug === pageSlug &&
      candidate.published &&
      settings.locale.locales.includes(locale),
  );
  if (!page) notFound();

  return (
    <main
      className="mx-auto min-h-[70vh] w-full max-w-3xl px-6 py-12"
      style={
        {
          "--cms-primary": settings.branding.primaryColor,
          "--cms-accent": settings.branding.accentColor,
        } as CSSProperties
      }
    >
      <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-slate-950">{page.title}</h1>
        <div className="mt-6 whitespace-pre-wrap text-base leading-7 text-slate-700">
          {page.content}
        </div>
      </article>
    </main>
  );
}
