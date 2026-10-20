import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Principal } from "@/core/tenancy/scope";
import { getPlatformStore } from "./platform";
import { getServerEnv } from "./env";

const ISSUER = "multi-tenant-e-commerce-platform";
const AUDIENCE = "super-admin";
const HOST_OWNER_AUDIENCE = "host-owner";
const TENANT_OWNER_AUDIENCE = "tenant-owner";

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

    return {
      userId: claims.data.sub,
      scope: claims.data.scope,
      permissions: ["platform:read", "platform:write"],
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

  const host = (await getPlatformStore().listHosts()).find(
    (candidate) => candidate.id === claims.data.scope.id,
  );
  if (!host || host.status !== "active") {
    return null;
  }

  return {
    userId: claims.data.sub,
    scope: claims.data.scope,
    permissions: ["tenant:read", "tenant:write"],
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
    scope: claims.data.scope,
    permissions: ["tenant:read", "tenant:write", "settings:read"],
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
