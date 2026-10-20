import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SetupWizard } from "@/features/setup/setup-wizard";
import { getPlatformStore } from "@/lib/server/platform";

export default async function SetupPage() {
  await connection();
  const state = await getPlatformStore().getSetupState();
  if (state.initialized) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-6 py-12">
      <section className="w-full space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Platform bootstrap
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Set up your platform
          </h1>
        </header>
        <SetupWizard />
      </section>
    </main>
  );
}
