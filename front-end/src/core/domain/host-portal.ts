import { z } from "zod";

export const HostOwnerSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  email: z.email(),
  passwordHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type HostOwner = z.infer<typeof HostOwnerSchema>;

export const HostOwnerInviteSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  email: z.email(),
  tokenHash: z.string().length(64),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type HostOwnerInvite = z.infer<typeof HostOwnerInviteSchema>;

export const TenantOwnerSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  hostId: z.uuid(),
  email: z.email(),
  passwordHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type TenantOwner = z.infer<typeof TenantOwnerSchema>;

export const TenantOwnerInviteSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  hostId: z.uuid(),
  email: z.email(),
  tokenHash: z.string().length(64),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type TenantOwnerInvite = z.infer<typeof TenantOwnerInviteSchema>;

export const TenantRecordSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  name: z.string().min(1).max(120),
  status: z.enum(["pending", "active", "suspended"]),
  plan: z.string().min(1).max(80),
  domains: z.array(z.string().min(1).max(253)).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TenantRecord = z.infer<typeof TenantRecordSchema>;

export const CreateTenantInputSchema = z.object({
  slug: TenantRecordSchema.shape.slug,
  name: TenantRecordSchema.shape.name,
  plan: TenantRecordSchema.shape.plan.default("starter"),
});

export const TenantDomainClaimSchema = z.object({
  tenantId: z.uuid(),
  hostId: z.uuid(),
  domain: z.string().min(1).max(253),
  verificationToken: z.string().length(64),
  createdAt: z.iso.datetime(),
});

export type TenantDomainClaim = z.infer<typeof TenantDomainClaimSchema>;

export const TenantStatusSchema = TenantRecordSchema.shape.status;
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

const LocaleTagSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const TenantDiscountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((value) => value.toUpperCase()),
    type: z.enum(["percentage", "fixed_amount"]),
    value: z.number().int().positive().max(2_147_483_647),
    minimumSubtotal: z.number().int().positive().max(2_147_483_647).optional(),
    expiresAt: z.iso.datetime().optional(),
    redemptionLimit: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .refine(
    (discount) => discount.type !== "percentage" || discount.value <= 99,
    "Percentage discounts must be between 1 and 99",
  );

const TenantDiscountsSchema = z
  .array(TenantDiscountSchema)
  .max(100)
  .refine(
    (discounts) =>
      new Set(discounts.map((discount) => discount.code)).size ===
      discounts.length,
    "Discount codes must be unique",
  );

export const TenantStoreSettingsSchema = z
  .object({
    branding: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500),
      logoUrl: z.url({ protocol: /^https$/ }).optional(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }),
    locale: z.object({
      defaultLocale: LocaleTagSchema,
      locales: z.array(LocaleTagSchema).min(1).max(20),
      currency: CurrencyCodeSchema,
      currencies: z.array(CurrencyCodeSchema).min(1).max(20),
    }),
    shipping: z
      .object({
        flatRate: z.number().int().min(0).max(2_147_483_647),
        freeShippingThreshold: z
          .number()
          .int()
          .positive()
          .max(2_147_483_647)
          .optional(),
      })
      .default({ flatRate: 0 })
      .refine(
        (shipping) =>
          shipping.freeShippingThreshold === undefined || shipping.flatRate > 0,
        "A free-shipping threshold requires a positive flat shipping rate",
      ),
    tax: z
      .object({
        rateBasisPoints: z.number().int().min(0).max(10_000),
      })
      .default({ rateBasisPoints: 0 }),
    discounts: TenantDiscountsSchema.default([]),
  })
  .superRefine((settings, context) => {
    if (!settings.locale.locales.includes(settings.locale.defaultLocale)) {
      context.addIssue({
        code: "custom",
        path: ["locale", "defaultLocale"],
        message: "Default locale must be included in supported locales",
      });
    }
    if (!settings.locale.currencies.includes(settings.locale.currency)) {
      context.addIssue({
        code: "custom",
        path: ["locale", "currency"],
        message: "Default currency must be included in supported currencies",
      });
    }
  });

export type TenantStoreSettings = z.infer<typeof TenantStoreSettingsSchema>;

export function createDefaultTenantStoreSettings(
  tenantName: string,
): TenantStoreSettings {
  return {
    branding: {
      name: tenantName,
      description: "",
      primaryColor: "#4338CA",
      accentColor: "#0F766E",
    },
    locale: {
      defaultLocale: "en",
      locales: ["en"],
      currency: "USD",
      currencies: ["USD"],
    },
    shipping: { flatRate: 0 },
    tax: { rateBasisPoints: 0 },
    discounts: [],
  };
}
