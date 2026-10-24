import { z } from "zod";
import { ProductVariantSelectionsSchema } from "./product";

export const TenantStaffPermissionSchema = z.enum([
  "catalog:read",
  "catalog:write",
  "orders:read",
  "orders:write",
]);

export const TenantStaffSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  hostId: z.uuid(),
  email: z.email(),
  passwordHash: z.string().min(1),
  permissions: z
    .array(TenantStaffPermissionSchema)
    .min(1)
    .refine(
      (permissions) =>
        (!permissions.includes("catalog:write") ||
          permissions.includes("catalog:read")) &&
        (!permissions.includes("orders:write") ||
          permissions.includes("orders:read")),
      "Write permissions require the matching read permission",
    ),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const TenantStaffViewSchema = TenantStaffSchema.omit({
  passwordHash: true,
});

export type TenantStaff = z.infer<typeof TenantStaffSchema>;
export type TenantStaffView = z.infer<typeof TenantStaffViewSchema>;
export type TenantStaffPermission = z.infer<typeof TenantStaffPermissionSchema>;

export const CustomerAccountSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  email: z.email(),
  passwordHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type CustomerAccount = z.infer<typeof CustomerAccountSchema>;

export const CustomerOrderItemSchema = z.object({
  productId: z.string().min(1).max(128),
  title: z.string().min(1),
  slug: z.string().min(1),
  quantity: z.number().int().positive(),
  variantSelections: ProductVariantSelectionsSchema.optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  inventoryTracked: z.boolean().optional(),
  unitPrice: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const CustomerDeliveryAddressSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/),
  country: z.literal("IN"),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/),
});
export type CustomerDeliveryAddress = z.infer<
  typeof CustomerDeliveryAddressSchema
>;

export const OrderFulfillmentSchema = z
  .object({
    carrier: z.string().trim().min(1).max(80).optional(),
    trackingNumber: z.string().trim().min(1).max(120),
    trackingUrl: z
      .url()
      .max(2048)
      .refine((value) => new URL(value).protocol === "https:", {
        message: "Tracking URLs must use HTTPS",
      })
      .optional(),
  })
  .strict();
export type OrderFulfillment = z.infer<typeof OrderFulfillmentSchema>;

const CustomerOrderBaseSchema = z.object({
  id: z.string().min(1).max(100),
  tenantId: z.uuid(),
  customerId: z.uuid(),
  status: z.enum(["Confirmed", "Processing", "Shipped"]),
  createdAt: z.iso.datetime(),
  items: z.array(CustomerOrderItemSchema).default([]),
  subtotal: z.number().int().min(0).max(2_147_483_647).optional(),
  shippingAmount: z.number().int().min(0).max(2_147_483_647).optional(),
  discountCode: z.string().trim().min(3).max(40).optional(),
  discountAmount: z.number().int().min(0).max(2_147_483_647).optional(),
  total: z.number().int().min(0).max(2_147_483_647),
  currency: z.string().regex(/^[A-Z]{3}$/),
  itemCount: z.number().int().positive(),
  paymentMethod: z.enum(["stripe", "cash_on_delivery"]).default("stripe"),
  paymentStatus: z
    .enum(["pending", "paid", "failed", "cod_due"])
    .default("paid"),
  paymentAttempt: z.number().int().nonnegative().default(0),
  paymentSessionId: z.string().min(1).optional(),
  paymentIntentId: z.string().min(1).optional(),
  deliveryAddress: CustomerDeliveryAddressSchema.optional(),
  fulfillment: OrderFulfillmentSchema.optional(),
  backendSyncStatus: z
    .enum(["not_configured", "pending", "synced", "failed"])
    .default("not_configured"),
  backendSyncError: z.string().max(200).optional(),
});

function validateOrderAmounts(
  order: Pick<
    z.infer<typeof CustomerOrderBaseSchema>,
    "items" | "subtotal" | "shippingAmount" | "discountAmount" | "total"
  >,
  context: z.RefinementCtx,
) {
  if (
    order.subtotal === undefined &&
    order.shippingAmount === undefined &&
    order.discountAmount === undefined
  )
    return;
  const subtotal =
    order.subtotal ??
    order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingAmount = order.shippingAmount ?? 0;
  const discountAmount = order.discountAmount ?? 0;
  if (
    !Number.isSafeInteger(subtotal) ||
    !Number.isSafeInteger(shippingAmount) ||
    !Number.isSafeInteger(discountAmount) ||
    discountAmount > subtotal ||
    !Number.isSafeInteger(order.total) ||
    subtotal - discountAmount + shippingAmount !== order.total
  ) {
    context.addIssue({
      code: "custom",
      path: ["total"],
      message: "Order total must equal subtotal plus shipping",
    });
  }
}

export const CustomerOrderSchema = CustomerOrderBaseSchema.superRefine(
  (order, context) => {
    validateOrderAmounts(order, context);
    if (
      order.paymentMethod === "cash_on_delivery" &&
      (order.currency !== "INR" ||
        !order.deliveryAddress ||
        !["cod_due", "paid"].includes(order.paymentStatus) ||
        order.paymentAttempt !== 0 ||
        order.paymentSessionId !== undefined ||
        order.paymentIntentId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Cash on delivery requires an Indian delivery address, INR currency, and a valid unpaid or collected status",
      });
    }
    if (order.paymentMethod === "stripe" && order.paymentStatus === "cod_due") {
      context.addIssue({
        code: "custom",
        message: "Stripe orders cannot be awaiting cash collection",
      });
    }
  },
);

export type CustomerOrder = z.infer<typeof CustomerOrderSchema>;

export const TenantOrderSchema = CustomerOrderBaseSchema.omit({
  backendSyncStatus: true,
  backendSyncError: true,
  paymentStatus: true,
  paymentAttempt: true,
  paymentSessionId: true,
  paymentIntentId: true,
}).superRefine((order, context) => {
  validateOrderAmounts(order, context);
  if (
    order.paymentMethod === "cash_on_delivery" &&
    (order.currency !== "INR" || !order.deliveryAddress)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Cash-on-delivery tenant orders require an Indian delivery address and INR currency",
    });
  }
});
export type TenantOrder = z.infer<typeof TenantOrderSchema>;
