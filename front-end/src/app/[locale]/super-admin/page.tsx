import { redirect } from "next/navigation";
import { connection } from "next/server";
import { HostManagement } from "@/features/hosts/host-management";
import { getPlatformStore } from "@/lib/server/platform";
import { getSuperAdminSession } from "@/lib/server/session";

type DashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function SuperAdminDashboardPage({
  params,
}: DashboardPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getSuperAdminSession();
  if (!session) {
    redirect(`/${locale}/super-admin/login`);
  }

  const hosts = await getPlatformStore().listHosts();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-5">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            Platform administration
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Super Admin</h1>
        </div>
        <form action="/api/auth/super-admin/logout" method="post">
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>
      <section className="py-10">
        <HostManagement initialHosts={hosts} />
      </section>
    </main>
  );
}
