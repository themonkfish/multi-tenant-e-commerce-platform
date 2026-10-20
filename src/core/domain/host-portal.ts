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
  domains: TenantRecordSchema.shape.domains,
});

export const TenantStatusSchema = TenantRecordSchema.shape.status;
export type TenantStatus = z.infer<typeof TenantStatusSchema>;
