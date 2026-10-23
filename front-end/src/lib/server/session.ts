import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { isScopeAllowedOnRequestDomain } from "@/core/tenancy/request-scope";
import { TenantStaffSchema } from "@/core/domain/tenant-identities";
import {
  canAccessPermission,
  ROLE_PERMISSIONS,
  type Principal,
} from "@/core/tenancy/scope";
import { getPlatformStore } from "./platform";
import { getServerEnv } from "./env";
import { getRequestDomainScope } from "./request-scope";

const ISSUER = "multi-tenant-e-commerce-platform";
const AUDIENCE = "super-admin";
const HOST_OWNER_AUDIENCE = "host-owner";
const TENANT_OWNER_AUDIENCE = "tenant-owner";
const TENANT_STAFF_AUDIENCE = "tenant-staff";
const CUSTOMER_AUDIENCE = "store-customer";

export function getSessionCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-super-admin"
    : "super-admin";
}

export function getHostOwnerCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-host-owner"
    : "host-owner";
}

export function getTenantOwnerCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-tenant-owner"
    : "tenant-owner";
}

export function getTenantStaffCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-tenant-staff"
    : "tenant-staff";
}

export function getCustomerCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-store-customer"
    : "store-customer";
}

function getSessionKey(): Uint8Array {
  const secret = getServerEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for Super Admin sessions");
  }
  return new TextEncoder().encode(secret);
}

export async function createSuperAdminSession(userId: string): Promise<string> {
  return new SignJWT({
    scope: { kind: "platform", id: "platform" },
    role: "super_admin",
    twoFactorVerified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionKey());
}

export async function createHostOwnerSession(
  userId: string,
  hostId: string,
): Promise<string> {
  return new SignJWT({
    scope: { kind: "host", id: hostId },
    role: "host_owner",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(HOST_OWNER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionKey());
}

export async function createTenantOwnerSession(
  userId: string,
  tenantId: string,
  hostId: string,
): Promise<string> {
  return new SignJWT({
    scope: { kind: "tenant", id: tenantId, hostId },
    role: "tenant_owner",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(TENANT_OWNER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionKey());
}

export async function createTenantStaffSession(
  userId: string,
  tenantId: string,
  hostId: string,
): Promise<string> {
  return new SignJWT({
    scope: { kind: "tenant", id: tenantId, hostId },
    role: "tenant_staff",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(TENANT_STAFF_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionKey());
}

export async function createCustomerSession(
  userId: string,
  tenantId: string,
  hostId: string,
): Promise<string> {
  return new SignJWT({
    scope: { kind: "tenant", id: tenantId, hostId },
    role: "customer",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(CUSTOMER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionKey());
}

const SessionClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.literal("super_admin"),
  twoFactorVerified: z.literal(true),
  scope: z.object({
    kind: z.literal("platform"),
    id: z.literal("platform"),
  }),
});

export async function getSuperAdminSession(): Promise<Principal | null> {
  const token = (await cookies()).get(getSessionCookieName())?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSessionKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const claims = SessionClaimsSchema.safeParse(payload);
    if (!claims.success) {
      return null;
    }

    if (
      !isScopeAllowedOnRequestDomain(
        await getRequestDomainScope(),
        claims.data.scope,
      )
    ) {
      return null;
    }

    return {
      userId: claims.data.sub,
      role: "super_admin",
      scope: claims.data.scope,
      permissions: [...ROLE_PERMISSIONS.super_admin],
    };
  } catch {
    return null;
  }
}

export async function getHostOwnerSession(): Promise<Principal | null> {
  const token = (await cookies()).get(getHostOwnerCookieName())?.value;
  if (!token) {
    return null;
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getSessionKey(), {
      issuer: ISSUER,
      audience: HOST_OWNER_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }

  const claims = z
    .object({
      sub: z.string().uuid(),
      role: z.literal("host_owner"),
      scope: z.object({
        kind: z.literal("host"),
        id: z.string().uuid(),
      }),
    })
    .safeParse(payload);
  if (!claims.success) {
    return null;
  }

  if (
    !isScopeAllowedOnRequestDomain(
      await getRequestDomainScope(),
      claims.data.scope,
    )
  ) {
    return null;
  }

  const host = (await getPlatformStore().listHosts()).find(
    (candidate) => candidate.id === claims.data.scope.id,
  );
  if (!host || host.status !== "active") {
    return null;
  }

  return {
    userId: claims.data.sub,
    role: "host_owner",
    scope: claims.data.scope,
    permissions: [...ROLE_PERMISSIONS.host_owner],
  };
}

export async function getTenantOwnerSession(): Promise<Principal | null> {
  const token = (await cookies()).get(getTenantOwnerCookieName())?.value;
  if (!token) {
    return null;
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getSessionKey(), {
      issuer: ISSUER,
      audience: TENANT_OWNER_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }

  const claims = z
    .object({
      sub: z.string().uuid(),
      role: z.literal("tenant_owner"),
      scope: z.object({
        kind: z.literal("tenant"),
        id: z.string().uuid(),
        hostId: z.string().uuid(),
      }),
    })
    .safeParse(payload);
  if (!claims.success) {
    return null;
  }

  if (
    !isScopeAllowedOnRequestDomain(
      await getRequestDomainScope(),
      claims.data.scope,
    )
  ) {
    return null;
  }

  const store = getPlatformStore();
  const [owner, hosts, tenants] = await Promise.all([
    store.getTenantOwnerForTenant(claims.data.sub, claims.data.scope.id),
    store.listHosts(),
    store.listTenantsForHost(claims.data.scope.hostId),
  ]);
  const host = hosts.find(
    (candidate) => candidate.id === claims.data.scope.hostId,
  );
  const tenant = tenants.find(
    (candidate) =>
      candidate.id === claims.data.scope.id &&
      candidate.hostId === claims.data.scope.hostId,
  );
  if (
    !owner ||
    owner.hostId !== claims.data.scope.hostId ||
    !host ||
    host.status !== "active" ||
    !tenant ||
    tenant.status !== "active"
  ) {
    return null;
  }

  return {
    userId: claims.data.sub,
    role: "tenant_owner",
    scope: claims.data.scope,
    permissions: [...ROLE_PERMISSIONS.tenant_owner],
  };
}

export async function getTenantStaffSession(): Promise<Principal | null> {
  const token = (await cookies()).get(getTenantStaffCookieName())?.value;
  if (!token) return null;

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getSessionKey(), {
      issuer: ISSUER,
      audience: TENANT_STAFF_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }

  const claims = z
    .object({
      sub: z.string().uuid(),
      role: z.literal("tenant_staff"),
      scope: z.object({
        kind: z.literal("tenant"),
        id: z.string().uuid(),
        hostId: z.string().uuid(),
      }),
    })
    .safeParse(payload);
  if (!claims.success) return null;
  const requestScope = await getRequestDomainScope();
  if (
    requestScope?.kind !== "tenant" ||
    requestScope.tenant.id !== claims.data.scope.id ||
    requestScope.host.id !== claims.data.scope.hostId
  ) {
    return null;
  }

  const store = getPlatformStore();
  const [record, hosts, tenants] = await Promise.all([
    store.getTenantStaffForTenant(claims.data.sub, claims.data.scope.id),
    store.listHosts(),
    store.listTenantsForHost(claims.data.scope.hostId),
  ]);
  const staff = record ? TenantStaffSchema.safeParse(record) : null;
  const host = hosts.find(
    (candidate) => candidate.id === claims.data.scope.hostId,
  );
  const tenant = tenants.find(
    (candidate) =>
      candidate.id === claims.data.scope.id &&
      candidate.hostId === claims.data.scope.hostId,
  );
  if (
    !staff?.success ||
    staff.data.hostId !== claims.data.scope.hostId ||
    !host ||
    host.status !== "active" ||
    !tenant ||
    tenant.status !== "active"
  ) {
    return null;
  }
  return {
    userId: claims.data.sub,
    role: "tenant_staff",
    scope: claims.data.scope,
    permissions: staff.data.permissions,
  };
}

export async function getTenantPortalSession(): Promise<Principal | null> {
  return (await getTenantOwnerSession()) ?? (await getTenantStaffSession());
}

export async function getTenantCatalogSession(): Promise<Principal | null> {
  const principal = await getTenantPortalSession();
  if (
    !principal ||
    principal.scope.kind !== "tenant" ||
    !canAccessPermission(principal, "catalog:read")
  ) {
    return null;
  }
  return principal;
}

export async function getCustomerSession(): Promise<Principal | null> {
  const token = (await cookies()).get(getCustomerCookieName())?.value;
  if (!token) return null;

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getSessionKey(), {
      issuer: ISSUER,
      audience: CUSTOMER_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }

  const claims = z
    .object({
      sub: z.string().uuid(),
      role: z.literal("customer"),
      scope: z.object({
        kind: z.literal("tenant"),
        id: z.string().uuid(),
        hostId: z.string().uuid(),
      }),
    })
    .safeParse(payload);
  if (!claims.success) return null;
  const requestScope = await getRequestDomainScope();
  if (
    requestScope?.kind !== "tenant" ||
    requestScope.tenant.id !== claims.data.scope.id ||
    requestScope.host.id !== claims.data.scope.hostId
  ) {
    return null;
  }

  const account = await getPlatformStore().getCustomerAccountForTenant(
    claims.data.scope.id,
    claims.data.sub,
  );
  if (!account) return null;
  return {
    userId: claims.data.sub,
    role: "customer",
    scope: requestScope.scope,
    permissions: [...ROLE_PERMISSIONS.customer],
  };
}

export function superAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: getServerEnv().NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 30 * 60,
  };
}

export function hostOwnerCookieOptions() {
  return {
    httpOnly: true,
    secure: getServerEnv().NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 30 * 60,
  };
}

export function tenantOwnerCookieOptions() {
  return hostOwnerCookieOptions();
}

export function tenantStaffCookieOptions() {
  return hostOwnerCookieOptions();
}

export function customerCookieOptions() {
  return hostOwnerCookieOptions();
}
