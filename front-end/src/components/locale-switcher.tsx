"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";

const localeNames: Record<string, string> = {
  en: "English",
  fr: "Francais",
  hi: "हिन्दी",
};

export function LocaleSwitcher({ locales }: { locales: readonly string[] }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <span className="sr-only">Language</span>
      <select
        aria-label="Language"
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
        value={locale}
        onChange={(event) =>
          router.replace(pathname, { locale: event.target.value })
        }
      >
        {locales.map((value) => (
          <option key={value} value={value}>
            {localeNames[value] ?? value}
          </option>
        ))}
      </select>
    </label>
  );
}
