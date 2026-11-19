import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { useTranslations } from "next-intl";

const ORDER_STAGES = [
  { status: "Confirmed", message: "confirmed" },
  { status: "Processing", message: "processing" },
  { status: "Shipped", message: "shipped" },
  { status: "Delivered", message: "delivered" },
] as const;

export function CustomerOrderProgress({
  status,
}: {
  status: CustomerOrder["status"];
}) {
  const t = useTranslations("CustomerOrderProgress");

  if (status === "Cancelled") {
    return (
      <p
        className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        role="status"
      >
        {t("cancelled")}
      </p>
    );
  }

  const activeStage = ORDER_STAGES.findIndex(
    (stage) => stage.status === status,
  );

  return (
    <ol
      aria-label={t("label")}
      className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {ORDER_STAGES.map((stage, index) => {
        const isCurrent = index === activeStage;
        const isComplete = index < activeStage;

        return (
          <li
            aria-current={isCurrent ? "step" : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
              isCurrent
                ? "bg-indigo-100 font-semibold text-indigo-900"
                : isComplete
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-white text-slate-500"
            }`}
            key={stage.status}
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs"
            >
              {isComplete ? "✓" : index + 1}
            </span>
            <span>{t(stage.message)}</span>
          </li>
        );
      })}
    </ol>
  );
}
