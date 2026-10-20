import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Principal } from "@/core/tenancy/scope";
import { getServerEnv } from "./env";

const ISSUER = "multi-tenant-e-commerce-platform";
const AUDIENCE = "super-admin";

export function getSessionCookieName(): string {
  return getServerEnv().NODE_ENV === "production"
    ? "__Host-super-admin"
    : "super-admin";
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

export function superAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: getServerEnv().NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 30 * 60,
  };
}
