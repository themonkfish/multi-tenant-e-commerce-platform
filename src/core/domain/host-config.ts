import { z } from "zod";

export const HostConfigSchema = z.object({
  id: z.uuid(),
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  name: z.string().min(1).max(120),
  status: z.enum(["pending", "active", "suspended"]),
  plan: z.string().min(1).max(80),
  limits: z.object({
    maxTenants: z.number().int().min(0).max(1_000_000),
    maxCustomDomains: z.number().int().min(0).max(10_000),
    features: z.record(z.string(), z.boolean()),
  }),
  branding: z.object({
    name: z.string().min(1).max(120),
    logoUrl: z.url().optional(),
    colors: z.record(z.string(), z.string()).optional(),
  }),
  domains: z.array(z.string().min(1).max(253)).max(100),
  supportContact: z.email().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type HostConfig = z.infer<typeof HostConfigSchema>;

export const CreateHostInputSchema = z.object({
  slug: HostConfigSchema.shape.slug,
  name: HostConfigSchema.shape.name,
  plan: HostConfigSchema.shape.plan,
  maxTenants: HostConfigSchema.shape.limits.shape.maxTenants,
  maxCustomDomains: HostConfigSchema.shape.limits.shape.maxCustomDomains,
  domains: z.array(z.string().min(1).max(253)).max(100),
  supportContact: z.email().optional(),
});

export type CreateHostInput = z.infer<typeof CreateHostInputSchema>;

export const HostStatusSchema = z.enum(["pending", "active", "suspended"]);
export type HostStatus = z.infer<typeof HostStatusSchema>;

export function normalizeHostDomain(input: string): string | null {
  const domain = input.trim().toLowerCase();
  try {
    const url = new URL(`https://${domain}`);
    if (
      url.hostname !== domain ||
      url.pathname !== "/" ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return domain;
  } catch {
    return null;
  }
}
