import { z } from "zod";

export const TenantStaffPermissionSchema = z.enum([
  "catalog:read",
  "catalog:write",
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
        !permissions.includes("catalog:write") ||
        permissions.includes("catalog:read"),
      "Catalog write requires catalog read",
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

export const CustomerOrderSchema = z.object({
  id: z.string().min(1).max(100),
  tenantId: z.uuid(),
  customerId: z.uuid(),
  status: z.enum(["Confirmed", "Processing", "Shipped"]),
  createdAt: z.iso.datetime(),
  total: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  itemCount: z.number().int().positive(),
});

export type CustomerOrder = z.infer<typeof CustomerOrderSchema>;
