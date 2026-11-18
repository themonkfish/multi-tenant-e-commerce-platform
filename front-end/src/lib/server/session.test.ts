import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";

const requestScopeMock = vi.hoisted(() => ({
  getRequestDomainScope: vi.fn(),
}));

const platformStoreMock = vi.hoisted(() => ({
  getPlatformStore: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === "super-admin" || name === "host-owner" || name === "tenant-owner" || name === "tenant-staff" || name === "store-customer") {
        return { value: "token" };
      }
      return undefined;
    },
  })),
}));

vi.mock("./request-scope", () => ({
  getRequestDomainScope: requestScopeMock.getRequestDomainScope,
}));

vi.mock("./platform", () => ({
  getPlatformStore: platformStoreMock.getPlatformStore,
}));

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    jwtVerify: vi.fn(),
  };
});

import {
  getCustomerSession,
  getHostOwnerSession,
  getSuperAdminSession,
  getTenantOwnerSession,
  getTenantStaffSession,
} from "./session";

const hostId = "11111111-1111-4111-8111-111111111111";
const otherHostId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
const otherTenantId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const staffId = "66666666-6666-4666-8666-666666666666";
const customerId = "77777777-7777-4777-8777-777777777777";

const host = {
  id: hostId,
  slug: "sample-host",
  name: "Sample Host",
  status: "active",
  plan: "starter",
  limits: { maxTenants: 10, maxCustomDomains: 2, features: {} },
  branding: { name: "Sample Host" },
  domains: ["host.example.com"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const tenant = {
  id: tenantId,
  hostId,
  slug: "sample-tenant",
  name: "Sample Tenant",
  status: "active",
  plan: "starter",
  domains: ["store.example.com"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const staffRecord = {
  id: staffId,
  tenantId,
  hostId,
  email: "staff@example.com",
  passwordHash: "hashed-password",
  permissions: ["catalog:read", "catalog:write", "orders:read", "orders:write"],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const customerRecord = {
  id: customerId,
  tenantId,
  email: "customer@example.com",
  passwordHash: "hashed-password",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("session boundary hardening", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    vi.clearAllMocks();
    platformStoreMock.getPlatformStore.mockReturnValue({
      listHosts: vi.fn(async () => [host]),
      listTenantsForHost: vi.fn(async () => [tenant]),
      getTenantOwnerForTenant: vi.fn(async () => ({
        id: userId,
        tenantId,
        hostId,
      })),
      getTenantStaffForTenant: vi.fn(async () => staffRecord),
      getCustomerAccountForTenant: vi.fn(async () => customerRecord),
    });
  });

  it("rejects a host-owner session when the request domain belongs to another host", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "host",
      domain: "other.example.com",
      host: { ...host, id: otherHostId },
      scope: { kind: "host", id: otherHostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: userId,
        role: "host_owner",
        scope: { kind: "host", id: hostId },
      },
    } as never);

    await expect(getHostOwnerSession()).resolves.toBeNull();
  });

  it("rejects a tenant-owner session on a mismatched tenant or host scope", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "tenant",
      domain: "tenant-two.example.com",
      host: { ...host, id: otherHostId },
      tenant: { ...tenant, id: otherTenantId, hostId: otherHostId },
      scope: { kind: "tenant", id: otherTenantId, hostId: otherHostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: userId,
        role: "tenant_owner",
        scope: { kind: "tenant", id: tenantId, hostId },
      },
    } as never);

    await expect(getTenantOwnerSession()).resolves.toBeNull();
  });

  it("rejects a customer session when the request scope does not match the customer tenant", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "tenant",
      domain: "other-store.example.com",
      host: { ...host, id: otherHostId },
      tenant: { ...tenant, id: otherTenantId, hostId: otherHostId },
      scope: { kind: "tenant", id: otherTenantId, hostId: otherHostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: customerId,
        role: "customer",
        scope: { kind: "tenant", id: tenantId, hostId },
      },
    } as never);

    await expect(getCustomerSession()).resolves.toBeNull();
  });

  it("accepts a valid tenant-staff session on the matching tenant scope", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "tenant",
      domain: "store.example.com",
      host,
      tenant,
      scope: { kind: "tenant", id: tenantId, hostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: staffId,
        role: "tenant_staff",
        scope: { kind: "tenant", id: tenantId, hostId },
      },
    } as never);

    const session = await getTenantStaffSession();
    expect(session).toMatchObject({
      userId: staffId,
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
    });
  });

  it("rejects a tenant-staff session on a mismatched tenant domain", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "tenant",
      domain: "other-store.example.com",
      host: { ...host, id: otherHostId },
      tenant: { ...tenant, id: otherTenantId, hostId: otherHostId },
      scope: { kind: "tenant", id: otherTenantId, hostId: otherHostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: staffId,
        role: "tenant_staff",
        scope: { kind: "tenant", id: tenantId, hostId },
      },
    } as never);

    await expect(getTenantStaffSession()).resolves.toBeNull();
  });

  it("rejects a super-admin session when the request is not on the platform domain", async () => {
    requestScopeMock.getRequestDomainScope.mockResolvedValue({
      kind: "host",
      domain: "host.example.com",
      host,
      scope: { kind: "host", id: hostId },
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: userId,
        role: "super_admin",
        twoFactorVerified: true,
        scope: { kind: "platform", id: "platform" },
      },
    } as never);

    await expect(getSuperAdminSession()).resolves.toBeNull();
  });
});
