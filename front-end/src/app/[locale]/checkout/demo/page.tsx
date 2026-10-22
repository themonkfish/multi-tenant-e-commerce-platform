import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StorefrontDemoCheckout } from "@/features/storefront/demo-checkout";
import {
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
} from "@/lib/server/demo-checkout";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import { getCustomerSession } from "@/lib/server/session";

type DemoCheckoutPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orderId?: string }>;
};

export default async function DemoCheckoutPage({
  params,
  searchParams,
}: DemoCheckoutPageProps) {
  const [{ locale }, { orderId }, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  if (!isLocalDemoCheckoutEnabled(requestHeaders.get("host"))) notFound();

  const requestScope = await getRequestDomainScope();
  if (requestScope?.kind !== "tenant") notFound();
  const customerSession = await getCustomerSession();
  if (
    !customerSession ||
    customerSession.scope.kind !== "tenant" ||
    customerSession.scope.id !== requestScope.tenant.id
  ) {
    notFound();
  }
  const order = orderId
    ? await getPlatformStore().getCustomerOrder(
        requestScope.tenant.id,
        customerSession.userId,
        orderId,
      )
    : null;
  if (
    !order ||
    order.paymentStatus !== "pending" ||
    !order.paymentSessionId ||
    !isDemoCheckoutSession(order.paymentSessionId)
  ) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          Local demo checkout
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          Simulate a payment
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          This local-only screen does not charge a card. Choose a result to test
          the order confirmation and delivery flow.
        </p>
      </header>
      <StorefrontDemoCheckout locale={locale} order={order} />
      <Link
        className="mt-6 inline-flex text-sm font-medium text-slate-700 underline"
        href={`/${locale}/cart`}
      >
        Return to cart
      </Link>
    </main>
  );
}
