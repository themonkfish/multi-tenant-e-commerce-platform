import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CustomerAuthForm } from "@/features/storefront/customer-auth-form";
import { getCustomerSession } from "@/lib/server/session";

export default async function CustomerLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (await getCustomerSession()) redirect(`/${locale}/account`);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Customer account
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Sign in or create an account
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Customer accounts belong to this store. Order history is private and
            visible only to the signed-in customer.
          </p>
        </header>
        <CustomerAuthForm />
      </section>
    </main>
  );
}
