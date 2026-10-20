import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SuperAdminLoginForm } from "@/features/auth/super-admin-login-form";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

type LoginPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function SuperAdminLoginPage({ params }: LoginPageProps) {
  await connection();
  const { locale } = await params;
  const state = await getPlatformStore().getSetupState();
  if (!state.initialized) {
    redirect(`/${locale}/setup`);
  }
  if (await getSuperAdminSession()) {
    redirect(`/${locale}/super-admin`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Platform administration
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Super Admin sign in
          </h1>
        </header>
        <SuperAdminLoginForm />
      </section>
    </main>
  );
}
