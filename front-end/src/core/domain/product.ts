import { z } from "zod";

export const ProductOptionSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    values: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  })
  .strict();

export const ProductOptionsSchema = z
  .array(ProductOptionSchema)
  .max(3)
  .refine(
    (options) =>
      new Set(options.map((option) => option.name.toLowerCase())).size ===
      options.length,
    "Option names must be unique",
  )
  .refine(
    (options) =>
      options.every(
        (option) =>
          new Set(option.values.map((value) => value.toLowerCase())).size ===
          option.values.length,
      ),
    "Option values must be unique",
  );

export const ProductVariantSelectionsSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40))
  .refine(
    (selections) => Object.keys(selections).length <= 3,
    "At most 3 variant options can be selected",
  );

export const ProductInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    status: z.enum(["draft", "active", "archived"]),
    price: z.object({
      amount: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
    sku: z.string().max(100).optional(),
    category: z.string().trim().min(1).max(80).nullable().optional(),
    options: ProductOptionsSchema.optional(),
    imageUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable()
      .optional(),
  })
  .strict();

export const ProductUpdateSchema = ProductInputSchema.partial().strict();
