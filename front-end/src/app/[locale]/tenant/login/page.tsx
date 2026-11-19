import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { TenantLoginForm } from "@/features/tenant-auth/tenant-login-form";
import { getTenantOwnerSession } from "@/lib/server/session";

type TenantLoginPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantLoginPage({
  params,
}: TenantLoginPageProps) {
  await connection();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "TenantAuth" });
  if (await getTenantOwnerSession()) {
    redirect(`/${locale}/tenant`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            {t("pageEyebrow")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {t("pageTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t("pageDescription")}
          </p>
        </header>
        <TenantLoginForm />
      </section>
    </main>
  );
}
