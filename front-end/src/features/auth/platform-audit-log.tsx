import type { AuditEvent } from "@/core/ports/platform-store";
import Link from "next/link";
import { useTranslations } from "next-intl";

function formatAuditDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? createdAt
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function PlatformAuditLog({ events }: { events: AuditEvent[] }) {
  const t = useTranslations("SuperAdminOperations");
  return (
    <section aria-labelledby="platform-audit-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="platform-audit-heading" className="text-xl font-semibold">
            {t("auditTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("auditDescription")}</p>
        </div>
        <Link
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          href="/api/platform/audit?limit=1000"
        >
          {t("exportJson")}
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          {t("noAuditEvents")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("time")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("action")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("resource")}
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  {t("actor")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    <time dateTime={event.createdAt}>
                      {formatAuditDate(event.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {event.action}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.resourceType}
                    {event.resourceId ? `: ${event.resourceId}` : ""}
                  </td>
                  <td className="max-w-64 break-all px-4 py-3 font-mono text-xs text-slate-600">
                    {event.actorId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
