import type { Metadata } from "next";
import { HostInviteAcceptForm } from "@/features/host-auth/host-invite-accept-form";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type AcceptInvitePageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function HostAcceptInvitePage({
  searchParams,
}: AcceptInvitePageProps) {
  const { token } = await searchParams;
  const inviteToken = typeof token === "string" ? token : "";
  const validToken = /^[A-Za-z0-9_-]{40,64}$/.test(inviteToken);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Host portal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Accept host owner invitation
          </h1>
        </header>
        {validToken ? (
          <HostInviteAcceptForm token={inviteToken} />
        ) : (
          <p className="text-sm leading-6 text-red-700" role="alert">
            This invitation link is missing or malformed. Ask the Super Admin
            for a new invitation.
          </p>
        )}
      </section>
    </main>
  );
}
