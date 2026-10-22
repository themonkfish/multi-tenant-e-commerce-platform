import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TenantStaffLoginForm } from "@/features/tenant-auth/tenant-staff-login-form";
import { getTenantStaffSession } from "@/lib/server/session";

export default async function TenantStaffLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  const session = await getTenantStaffSession();
  if (session) {
    redirect(
      session.permissions.includes("orders:read")
        ? `/${locale}/tenant/orders`
        : `/${locale}/tenant/products`,
    );
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Staff portal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Tenant staff sign in
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Staff access is limited to catalog and order permissions granted by
            the store owner.
          </p>
        </header>
        <TenantStaffLoginForm />
      </section>
    </main>
  );
}
