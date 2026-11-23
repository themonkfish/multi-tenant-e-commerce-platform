import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantOwnerSession,
  getPlatformStore,
  getSecretVault,
  isSameOrigin,
  createRateLimitKey,
  canAccessPermission,
} = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getSecretVault: vi.fn(),
  isSameOrigin: vi.fn(),
  createRateLimitKey: vi.fn(),
  canAccessPermission: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore,
  getSecretVault,
}));
vi.mock("@/lib/server/http", () => ({ isSameOrigin, createRateLimitKey }));
vi.mock("@/core/tenancy/scope", () => ({ canAccessPermission }));

import { DELETE, PUT } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const ownerId = "550e8400-e29b-41d4-a716-446655440020";

function request(method: "PUT" | "DELETE", body?: unknown) {
  return new Request("https://store.example.com/api/tenant/data-provider", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://store.example.com",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setupStore(overrides: Record<string, unknown> = {}) {
  const store = {
    consumeRateLimit: vi.fn().mockResolvedValue(true),
    getTenantDatabaseProvider: vi.fn().mockResolvedValue(null),
    updateTenantDatabaseProvider: vi.fn(),
    deleteTenantDatabaseProvider: vi.fn(),
    ...overrides,
  };
  getPlatformStore.mockReturnValue(store);
  getTenantOwnerSession.mockResolvedValue({
    userId: ownerId,
    role: "tenant_owner",
    scope: { kind: "tenant", id: tenantId, hostId },
    permissions: ["tenant:read", "tenant:write"],
  });
  canAccessPermission.mockReturnValue(true);
  isSameOrigin.mockReturnValue(true);
  createRateLimitKey.mockReturnValue("database-provider-rate-key");
  return store;
}

describe("tenant database provider credential management", () => {
  afterEach(() => vi.clearAllMocks());

  it("saves a supplied credential and deletes the old secret after provider replacement", async () => {
    const existing = {
      type: "supabase" as const,
      projectUrl: "https://old-project.supabase.co",
      serviceKeyRef: "old-secret",
      schema: "public" as const,
      tenancyMode: "dedicated-project" as const,
    };
    const saved = {
      type: "mongodb" as const,
      dbName: "tenant_catalog",
      tenancyMode: "dedicated-db" as const,
      connectionRef: "new-secret",
    };
    const store = setupStore({
      getTenantDatabaseProvider: vi.fn().mockResolvedValue(existing),
      updateTenantDatabaseProvider: vi.fn().mockResolvedValue(saved),
    });
    const putSecret = vi.fn().mockResolvedValue("new-secret");
    const deleteSecret = vi.fn().mockResolvedValue(undefined);
    getSecretVault.mockReturnValue({ putSecret, deleteSecret });

    const response = await PUT(
      request("PUT", {
        type: "mongodb",
        dbName: "tenant_catalog",
        connectionString:
          "mongodb+srv://catalog-user:password@cluster.ab12.mongodb.net/",
      }),
    );

    expect(response.status).toBe(200);
    expect(store.updateTenantDatabaseProvider).toHaveBeenCalledWith(
      expect.objectContaining({ config: saved }),
    );
    expect(deleteSecret).toHaveBeenCalledWith("old-secret");
  });

  it("requires a credential when replacing a provider without an existing same-provider secret", async () => {
    setupStore({
      getTenantDatabaseProvider: vi.fn().mockResolvedValue({
        type: "supabase",
        projectUrl: "https://old-project.supabase.co",
        serviceKeyRef: "old-secret",
        schema: "public",
        tenancyMode: "dedicated-project",
      }),
    });
    getSecretVault.mockReturnValue({
      putSecret: vi.fn(),
      deleteSecret: vi.fn(),
    });

    const response = await PUT(
      request("PUT", {
        type: "mongodb",
        dbName: "tenant_catalog",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "credential_required" });
  });

  it("returns a cleanup warning when deleting the provider succeeds but secret cleanup fails", async () => {
    const existing = {
      type: "supabase" as const,
      projectUrl: "https://tenant-project.supabase.co",
      serviceKeyRef: "tenant-secret",
      schema: "public" as const,
      tenancyMode: "dedicated-project" as const,
    };
    setupStore({
      getTenantDatabaseProvider: vi.fn().mockResolvedValue(existing),
      deleteTenantDatabaseProvider: vi.fn().mockResolvedValue(true),
    });
    getSecretVault.mockReturnValue({
      deleteSecret: vi.fn().mockRejectedValue(new Error("vault unavailable")),
    });

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      removed: true,
      warning: "credential_cleanup_failed",
    });
  });
});
