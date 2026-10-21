import { z } from "zod";

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
  })
  .strict();

export const ProductUpdateSchema = ProductInputSchema.partial().strict();
