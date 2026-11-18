import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "fr", "hi"],
  defaultLocale: "en",
  localePrefix: "always",
});
