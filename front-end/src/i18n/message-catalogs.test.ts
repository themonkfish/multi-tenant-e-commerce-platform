import { describe, expect, it } from "vitest";
import enMessages from "../../messages/en.json";
import frMessages from "../../messages/fr.json";
import hiMessages from "../../messages/hi.json";

const localizedMessages = {
  en: enMessages,
  fr: frMessages,
  hi: hiMessages,
};

const namespaces = [
  "CustomerAuth",
  "CustomerAccount",
  "CustomerCart",
  "CustomerCatalog",
  "CustomerCheckout",
  "CustomerProduct",
  "Home",
  "TenantAuth",
  "CustomerOrderProgress",
  "CustomerOrderSync",
  "TenantSettings",
  "TenantStaff",
  "TenantSetup",
  "TenantDatabase",
  "TenantStorage",
  "TenantPortal",
  "TenantCatalog",
  "TenantOrders",
  "TenantInvite",
  "HostAuth",
  "SuperAdminAuth",
  "SuperAdminPortal",
  "SuperAdminHosts",
  "HostTenants",
  "SuperAdminSettings",
  "SuperAdminOperations",
  "PlatformSetup",
] as const;

function flattenMessages(
  value: unknown,
  prefix = "",
  messages: Record<string, string> = {},
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return messages;
  }

  for (const [key, child] of Object.entries(value)) {
    const messageKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      messages[messageKey] = child;
    } else {
      flattenMessages(child, messageKey, messages);
    }
  }
  return messages;
}

function placeholders(message: string): string[] {
  return [
    ...new Set(
      Array.from(message.matchAll(/\{([A-Za-z0-9_]+)/g), (match) => match[1]),
    ),
  ].sort();
}

function richTags(message: string): string[] {
  return Array.from(message.matchAll(/<\/?[a-z][a-z0-9]*>/gi), (match) =>
    match[0].toLowerCase(),
  ).sort();
}

describe("localized message catalogs", () => {
  it.each(namespaces)(
    "keeps %s keys and interpolation variables aligned across locales",
    (namespace) => {
      const english = flattenMessages(localizedMessages.en[namespace]);
      const expectedKeys = Object.keys(english).sort();

      for (const locale of ["fr", "hi"] as const) {
        const translated = flattenMessages(
          localizedMessages[locale][namespace],
        );
        expect(Object.keys(translated).sort()).toEqual(expectedKeys);
        for (const key of expectedKeys) {
          expect(placeholders(translated[key])).toEqual(
            placeholders(english[key]),
          );
          expect(richTags(translated[key])).toEqual(richTags(english[key]));
        }
      }
    },
  );
});
