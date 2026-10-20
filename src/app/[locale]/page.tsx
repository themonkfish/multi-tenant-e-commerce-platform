import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function HomePage() {
  const t = await getTranslations("Home");

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
