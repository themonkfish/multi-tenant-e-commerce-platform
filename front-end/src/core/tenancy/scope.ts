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

export const PrincipalRoleSchema = z.enum([
  "super_admin",
  "host_owner",
  "tenant_owner",
]);
export type PrincipalRole = z.infer<typeof PrincipalRoleSchema>;

export const PermissionSchema = z.enum([
  "platform:read",
  "platform:write",
  "tenant:read",
  "tenant:write",
  "settings:read",
  "settings:write",
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const ROLE_PERMISSIONS = {
  super_admin: ["platform:read", "platform:write"],
  host_owner: ["tenant:read", "tenant:write"],
  tenant_owner: [
    "tenant:read",
    "tenant:write",
    "settings:read",
    "settings:write",
  ],
} as const satisfies Record<PrincipalRole, readonly Permission[]>;

export const PrincipalSchema = z.object({
  userId: z.string().min(1),
  role: PrincipalRoleSchema,
  scope: AccessScopeSchema,
  permissions: z.array(PermissionSchema),
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

  return (
    targetScope.kind === "tenant" &&
    principalScope.id === targetScope.id &&
    principalScope.hostId === targetScope.hostId
  );
}

export function hasPermission(
  principal: Principal,
  permission: Permission,
): boolean {
  const rolePermissions: readonly Permission[] =
    ROLE_PERMISSIONS[principal.role];
  return (
    rolePermissions.includes(permission) &&
    principal.permissions.includes(permission)
  );
}

export function canAccessPermission(
  principal: Principal,
  permission: Permission,
  targetScope: AccessScope = principal.scope,
): boolean {
  return (
    hasPermission(principal, permission) &&
    canAccessScope(principal.scope, targetScope)
  );
}
