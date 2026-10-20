import { z } from "zod";

export const AccessScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("platform"), id: z.literal("platform") }),
  z.object({ kind: z.literal("host"), id: z.string().min(1) }),
  z.object({
    kind: z.literal("tenant"),
    id: z.string().min(1),
    hostId: z.string().min(1),
  }),
]);

export type AccessScope = z.infer<typeof AccessScopeSchema>;

export const PrincipalSchema = z.object({
  userId: z.string().min(1),
  scope: AccessScopeSchema,
  permissions: z.array(z.string()),
});

export type Principal = z.infer<typeof PrincipalSchema>;

export function canAccessScope(
  principalScope: AccessScope,
  targetScope: AccessScope,
): boolean {
  if (principalScope.kind === "platform") {
    return true;
  }

  if (principalScope.kind === "host") {
    if (targetScope.kind === "host") {
      return principalScope.id === targetScope.id;
    }

    return (
      targetScope.kind === "tenant" && principalScope.id === targetScope.hostId
    );
  }

  return targetScope.kind === "tenant" && principalScope.id === targetScope.id;
}

export function hasPermission(
  principal: Principal,
  permission: string,
): boolean {
  return principal.permissions.includes(permission);
}
