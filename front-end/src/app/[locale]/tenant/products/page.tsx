import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TenantProductManagement } from "@/features/tenants/tenant-product-management";
import { getTenantOwnerSession } from "@/lib/server/session";

type TenantProductsPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function TenantProductsPage({
  params,
}: TenantProductsPageProps) {
  await connection();
  const { locale } = await params;
  const session = await getTenantOwnerSession();

  if (!session || session.scope.kind !== "tenant") {
    redirect(`/${locale}/tenant/login`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            Tenant catalog
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage the catalog connected to your tenant backend.
          </p>
        </div>
        <a
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          href={`/${locale}/tenant`}
        >
          Back to dashboard
        </a>
      </header>

      <section className="py-8">
        <TenantProductManagement />
      </section>
    </main>
  );
}
