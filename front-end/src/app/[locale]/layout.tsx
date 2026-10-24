import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import { routing } from "@/i18n/routing";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestDomainScope } from "@/lib/server/request-scope";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getPlatformStore().getSetupState();
  return {
    title: settings.name,
    description: `${settings.name} — a configurable commerce workspace.`,
  };
}

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [requestScope, { settings }] = await Promise.all([
    getRequestDomainScope(),
    getPlatformStore().getSetupState(),
  ]);
  if (requestScope?.kind === "unavailable") {
    notFound();
  }

  return (
    <html lang={locale}>
      <body
        className="min-h-screen antialiased"
        style={
          {
            "--platform-primary": settings.primaryColor,
            "--platform-accent": settings.accentColor,
          } as CSSProperties
        }
      >
        <NextIntlClientProvider>
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
        {requestScope?.kind !== "tenant" && (
          <footer
            className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-sm"
            style={{ borderColor: settings.accentColor }}
          >
            <span>{settings.name}</span>
            <nav aria-label="Legal information" className="flex gap-4">
              {settings.termsUrl && (
                <a
                  href={settings.termsUrl}
                  rel="noreferrer"
                  target="_blank"
                  style={{ color: settings.primaryColor }}
                >
                  Terms
                </a>
              )}
              {settings.privacyUrl && (
                <a
                  href={settings.privacyUrl}
                  rel="noreferrer"
                  target="_blank"
                  style={{ color: settings.primaryColor }}
                >
                  Privacy
                </a>
              )}
            </nav>
          </footer>
        )}
      </body>
    </html>
  );
}
