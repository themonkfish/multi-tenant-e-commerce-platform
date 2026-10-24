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

export const ProductVariantSchema = z
  .object({
    selections: ProductVariantSelectionsSchema,
    stock: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const ProductVariantsSchema = z
  .array(ProductVariantSchema)
  .max(200)
  .refine(
    (variants) =>
      new Set(
        variants.map((variant) =>
          JSON.stringify(
            Object.entries(variant.selections).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        ),
      ).size === variants.length,
    "Variant selections must be unique",
  );

const ProductShapeSchema = z
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
    variants: ProductVariantsSchema.optional(),
    imageUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable()
      .optional(),
  }).strict();

function validateProductVariants(
  product: {
    options?: { name: string; values: string[] }[];
    variants?: { selections: Record<string, string>; stock: number }[];
  },
  context: z.RefinementCtx,
) {
    if (product.variants?.length && product.options === undefined) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Inventory variants require product options",
      });
      return;
    }
    if (!product.variants?.length || !product.options) return;
    if (
      product.options.reduce(
        (count, option) => count * option.values.length,
        1,
      ) > 200
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Products can have at most 200 sellable variants",
      });
      return;
    }
    const selections = product.options.reduce<Record<string, string>[]>(
      (combinations, option) =>
        combinations.flatMap((combination) =>
          option.values.map((value) => ({ ...combination, [option.name]: value })),
        ),
      [{}],
    );
    if (selections.length > 200) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Products can have at most 200 sellable variants",
      });
      return;
    }
    const variantKeys = new Set(
      product.variants.map((variant) =>
        JSON.stringify(
          Object.entries(variant.selections).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
    );
    if (
      selections.length !== variantKeys.size ||
      selections.some(
        (selection) =>
          !variantKeys.has(
            JSON.stringify(
              Object.entries(selection).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          ),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Inventory must be configured for every option combination",
      });
    }
}

export const ProductInputSchema =
  ProductShapeSchema.superRefine(validateProductVariants);

export const ProductUpdateSchema = ProductShapeSchema.partial()
  .strict()
  .superRefine((product, context) => {
    if (product.options !== undefined && product.variants !== undefined) {
      validateProductVariants(product, context);
    }
  });
