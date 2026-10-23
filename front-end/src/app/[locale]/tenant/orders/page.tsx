export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TenantOrderManagement } from "@/features/tenant-auth/tenant-order-management";
import { canAccessPermission } from "@/core/tenancy/scope";
import { getTenantPortalSession } from "@/lib/server/session";

type TenantOrdersPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantOrdersPage({
  params,
}: TenantOrdersPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    redirect(`/${locale}/tenant/login`);
  }
  if (!canAccessPermission(session, "orders:read")) {
    redirect(
      session.role === "tenant_staff"
        ? `/${locale}/tenant/products`
        : `/${locale}/tenant`,
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            Tenant operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Orders</h1>
          <p className="mt-1 text-sm text-slate-600">
            Orders synchronized to your connected Tenant backend.
          </p>
        </div>
        <a
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          href={
            session.role === "tenant_owner"
              ? `/${locale}/tenant`
              : `/${locale}/tenant/products`
          }
        >
          {session.role === "tenant_owner" ? "Back to dashboard" : "Catalog"}
        </a>
        {session.role === "tenant_staff" && (
          <form action="/api/tenant/staff/auth/logout" method="post">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
              type="submit"
            >
              Sign out
            </button>
          </form>
        )}
      </header>
      <section className="py-8">
        <TenantOrderManagement
          canManage={canAccessPermission(session, "orders:write")}
          locale={locale}
        />
      </section>
    </main>
  );
}
