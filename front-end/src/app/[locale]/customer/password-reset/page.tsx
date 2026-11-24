import { connection } from "next/server";
import { CustomerPasswordResetForm } from "@/features/storefront/customer-password-reset-form";

export default async function CustomerPasswordResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tenant?: string; token?: string }>;
}) {
  await connection();
  const { locale } = await params;
  const { tenant, token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full">
        <CustomerPasswordResetForm
          locale={locale}
          tenantId={tenant}
          token={token}
        />
      </section>
    </main>
  );
}
