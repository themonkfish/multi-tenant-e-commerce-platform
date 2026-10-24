import { describe, expect, it, vi } from "vitest";
import type { HostConfig } from "@/core/domain/host-config";
import type { TenantRecord } from "@/core/domain/host-portal";
import type { PlatformStore } from "@/core/ports/platform-store";
import { DEFAULT_PLATFORM_SETTINGS } from "@/core/domain/platform-settings";
import {
  getReservedPlatformDomains,
  normalizeHostDomain,
  normalizeReservedSubdomains,
} from "@/core/domain/host-config";
import {
  isScopeAllowedOnRequestDomain,
  normalizeRequestDomain,
  resolveRequestScope,
} from "./request-scope";

const host: HostConfig = {
  id: "550e8400-e29b-41d4-a716-446655440000",
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

const tenant: TenantRecord = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  hostId: host.id,
  slug: "sample-store",
  name: "Sample Store",
  status: "active",
  plan: "starter",
  domains: ["store.example.com"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function createStore(
  overrides: Partial<
    Pick<
      PlatformStore,
      "getSetupState" | "getHostById" | "getHostByDomain" | "getTenantByDomain"
    >
  > = {},
) {
  return {
    getSetupState: vi.fn(
      overrides.getSetupState ??
        (async () => ({
          initialized: true,
          platformDomain: "platform.example.com",
          reservedSubdomains: [],
          settings: DEFAULT_PLATFORM_SETTINGS,
        })),
    ),
    getHostById: vi.fn(overrides.getHostById ?? (async () => host)),
    getHostByDomain: vi.fn(
      overrides.getHostByDomain ??
        (async (domain: string) =>
          domain === "host.example.com" ? host : null),
    ),
    getTenantByDomain: vi.fn(
      overrides.getTenantByDomain ??
        (async (domain: string) =>
          domain === "store.example.com" ? tenant : null),
    ),
  };
}

describe("normalizeHostDomain and reserved platform subdomains", () => {
  it("normalizes case and removes a valid port and trailing dot", () => {
    expect(normalizeRequestDomain("Store.Example.com.:443")).toBe(
      "store.example.com",
    );
    expect(normalizeHostDomain("STORE.EXAMPLE.COM.")).toBe("store.example.com");
  });

  it("builds reserved platform domains from normalized host labels", () => {
    expect(
      getReservedPlatformDomains("platform.example.com", [
        "admin",
        "API",
        "",
        "api",
        "platform.example.com",
      ]),
    ).toEqual(
      new Set(["admin.platform.example.com", "api.platform.example.com"]),
    );
  });

  it("normalizes reserved subdomains and drops duplicate or invalid values", () => {
    expect(
      normalizeReservedSubdomains([
        " API ",
        "admin",
        "admin",
        "",
        "www",
        "example.com",
      ]),
    ).toEqual(["api", "admin", "www"]);
    expect(
      getReservedPlatformDomains("platform.example.com.", ["API", "www"]),
    ).toEqual(
      new Set(["api.platform.example.com", "www.platform.example.com"]),
    );
  });
});

describe("normalizeRequestDomain", () => {
  it.each([
    null,
    "",
    "store.example.com/path",
    "store.example.com,attacker.test",
  ])("rejects invalid host headers: %s", (hostHeader) => {
    expect(normalizeRequestDomain(hostHeader)).toBeNull();
  });
});

describe("resolveRequestScope", () => {
  it("resolves the configured platform domain", async () => {
    const store = createStore();

    await expect(
      resolveRequestScope("PLATFORM.EXAMPLE.COM:443", store),
    ).resolves.toEqual({
      kind: "platform",
      domain: "platform.example.com",
      scope: { kind: "platform", id: "platform" },
    });
    expect(store.getTenantByDomain).not.toHaveBeenCalled();
  });

  it("resolves active host and tenant scopes by exact domain", async () => {
    const store = createStore();

    await expect(
      resolveRequestScope("host.example.com", store),
    ).resolves.toMatchObject({
      kind: "host",
      scope: { kind: "host", id: host.id },
    });
    await expect(
      resolveRequestScope("store.example.com", store),
    ).resolves.toMatchObject({
      kind: "tenant",
      scope: { kind: "tenant", id: tenant.id, hostId: host.id },
    });
  });

  it("marks inactive tenants and tenants whose host is inactive unavailable", async () => {
    const inactiveTenantStore = createStore({
      getTenantByDomain: async () => ({ ...tenant, status: "suspended" }),
    });
    const inactiveHostStore = createStore({
      getHostById: async () => ({ ...host, status: "suspended" }),
    });

    await expect(
      resolveRequestScope("store.example.com", inactiveTenantStore),
    ).resolves.toEqual({
      kind: "unavailable",
      domain: "store.example.com",
    });
    await expect(
      resolveRequestScope("store.example.com", inactiveHostStore),
    ).resolves.toEqual({
      kind: "unavailable",
      domain: "store.example.com",
    });
  });

  describe("isScopeAllowedOnRequestDomain", () => {
    it("allows unresolved and platform domains to serve existing portals", async () => {
      const platformScope = await resolveRequestScope(
        "platform.example.com",
        createStore(),
      );

      expect(
        isScopeAllowedOnRequestDomain(null, { kind: "host", id: host.id }),
      ).toBe(true);
      expect(
        isScopeAllowedOnRequestDomain(platformScope, {
          kind: "tenant",
          id: tenant.id,
          hostId: host.id,
        }),
      ).toBe(true);
    });

    it("restricts host and tenant domains to their matching access scopes", async () => {
      const store = createStore();
      const hostScope = await resolveRequestScope("host.example.com", store);
      const tenantScope = await resolveRequestScope("store.example.com", store);

      expect(
        isScopeAllowedOnRequestDomain(hostScope, { kind: "host", id: host.id }),
      ).toBe(true);
      expect(
        isScopeAllowedOnRequestDomain(hostScope, {
          kind: "host",
          id: "different-host",
        }),
      ).toBe(false);
      expect(
        isScopeAllowedOnRequestDomain(hostScope, {
          kind: "tenant",
          id: tenant.id,
          hostId: host.id,
        }),
      ).toBe(false);
      expect(
        isScopeAllowedOnRequestDomain(tenantScope, {
          kind: "tenant",
          id: tenant.id,
          hostId: host.id,
        }),
      ).toBe(true);
      expect(
        isScopeAllowedOnRequestDomain(tenantScope, {
          kind: "tenant",
          id: "different-tenant",
          hostId: host.id,
        }),
      ).toBe(false);
      expect(
        isScopeAllowedOnRequestDomain(tenantScope, {
          kind: "host",
          id: host.id,
        }),
      ).toBe(false);
      expect(
        isScopeAllowedOnRequestDomain(tenantScope, {
          kind: "platform",
          id: "platform",
        }),
      ).toBe(false);
    });

    it("denies access on inactive domains", () => {
      expect(
        isScopeAllowedOnRequestDomain(
          { kind: "unavailable", domain: "store.example.com" },
          { kind: "tenant", id: tenant.id, hostId: host.id },
        ),
      ).toBe(false);
    });
  });

  it("returns no scope for unregistered domains and marks inactive hosts unavailable", async () => {
    const inactiveHostStore = createStore({
      getHostByDomain: async () => ({ ...host, status: "suspended" }),
    });

    await expect(
      resolveRequestScope("unknown.example.com", createStore()),
    ).resolves.toBeNull();
    await expect(
      resolveRequestScope("host.example.com", inactiveHostStore),
    ).resolves.toEqual({
      kind: "unavailable",
      domain: "host.example.com",
    });
    await expect(
      resolveRequestScope("invalid/path", createStore()),
    ).resolves.toBeNull();
  });
});
