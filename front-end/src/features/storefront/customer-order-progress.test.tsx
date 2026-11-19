import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../messages/en.json";
import frMessages from "../../../messages/fr.json";
import hiMessages from "../../../messages/hi.json";
import { CustomerOrderProgress } from "./customer-order-progress";

const localeMessages = [
  ["en", enMessages, "Order progress", "Delivered", "Order cancelled."],
  ["fr", frMessages, "Suivi de la commande", "Livrée", "Commande annulée."],
  [
    "hi",
    hiMessages,
    "ऑर्डर की प्रगति",
    "डिलीवर किया गया",
    "ऑर्डर रद्द कर दिया गया है।",
  ],
] as const;

function renderProgress(
  locale: string,
  messages: (typeof localeMessages)[number][1],
  status: "Delivered" | "Cancelled",
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CustomerOrderProgress status={status} />
    </NextIntlClientProvider>,
  );
}

describe("CustomerOrderProgress", () => {
  it.each(localeMessages)(
    "renders the accessible progress timeline in %s",
    (locale, messages, label, delivered) => {
      const markup = renderProgress(locale, messages, "Delivered");

      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain('aria-current="step"');
      expect(markup).toContain(`>${delivered}</span>`);
      expect(markup.match(/✓/g)).toHaveLength(3);
    },
  );

  it.each(localeMessages)(
    "localizes cancellation separately in %s",
    (locale, messages, _label, _delivered, cancelled) => {
      const markup = renderProgress(locale, messages, "Cancelled");

      expect(markup).toContain('role="status"');
      expect(markup).toContain(cancelled);
      expect(markup).not.toContain('aria-label="');
    },
  );
});
