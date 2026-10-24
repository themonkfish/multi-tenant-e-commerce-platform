import { z } from "zod";

export const PlatformSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  termsUrl: z.url({ protocol: /^https$/ }).optional(),
  privacyUrl: z.url({ protocol: /^https$/ }).optional(),
});

export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  name: "Multi-tenant Commerce Platform",
  primaryColor: "#4338CA",
  accentColor: "#0F766E",
};
