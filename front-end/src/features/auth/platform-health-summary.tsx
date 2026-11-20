import Link from "next/link";
import { useTranslations } from "next-intl";

export function PlatformHealthSummary({
  setupComplete,
  hostCount,
  tenantCount,
  activeHostCount,
  activeTenantCount,
}: {
  setupComplete: boolean;
  hostCount: number;
  tenantCount: number;
  activeHostCount: number;
  activeTenantCount: number;
}) {
  const t = useTranslations("SuperAdminOperations");
  const healthy = setupComplete;

  return (
    <section aria-labelledby="platform-health-heading" className="space-y-4">
      <div>
        <h2 id="platform-health-heading" className="text-xl font-semibold">
          {t("healthTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("healthDescription")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("platformStore")}</p>
          <p
            className={`mt-1 font-semibold ${
              healthy ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {healthy ? t("configured") : t("setupIncomplete")}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("hosts")}</p>
          <p className="mt-1 font-semibold">
            {t("activeOfTotal", { active: activeHostCount, total: hostCount })}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("tenants")}</p>
          <p className="mt-1 font-semibold">
            {t("activeOfTotal", {
              active: activeTenantCount,
              total: tenantCount,
            })}
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{t("publicHealth")}</p>
          <Link
            className="mt-1 block font-semibold text-indigo-700 hover:underline"
            href="/api/health"
          >
            {t("viewHealthJson")}
          </Link>
        </article>
      </div>
    </section>
  );
}
