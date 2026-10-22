import { z } from "zod";

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
  unitPrice: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const CustomerOrderSchema = z.object({
  id: z.string().min(1).max(100),
  tenantId: z.uuid(),
  customerId: z.uuid(),
  status: z.enum(["Confirmed", "Processing", "Shipped"]),
  createdAt: z.iso.datetime(),
  items: z.array(CustomerOrderItemSchema).default([]),
  total: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  itemCount: z.number().int().positive(),
  paymentStatus: z.enum(["pending", "paid", "failed"]).default("paid"),
  paymentAttempt: z.number().int().nonnegative().default(0),
  paymentSessionId: z.string().min(1).optional(),
  paymentIntentId: z.string().min(1).optional(),
  backendSyncStatus: z
    .enum(["not_configured", "pending", "synced", "failed"])
    .default("not_configured"),
  backendSyncError: z.string().max(200).optional(),
});

export type CustomerOrder = z.infer<typeof CustomerOrderSchema>;

export const TenantOrderSchema = CustomerOrderSchema.omit({
  backendSyncStatus: true,
  backendSyncError: true,
  paymentStatus: true,
  paymentAttempt: true,
  paymentSessionId: true,
  paymentIntentId: true,
});
export type TenantOrder = z.infer<typeof TenantOrderSchema>;
