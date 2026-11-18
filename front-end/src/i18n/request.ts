import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

const messageLoaders = {
  en: () => import("../../messages/en.json"),
  fr: () => import("../../messages/fr.json"),
  hi: () => import("../../messages/hi.json"),
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale;

  return {
    locale,
    messages: (await messageLoaders[locale]()).default,
  };
});
