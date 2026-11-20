import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantOwnerSession, getPlatformStore, createTenantStorageAdapter } =
  vi.hoisted(() => ({
    getTenantOwnerSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createTenantStorageAdapter: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/storage/tenant-storage-provider", () => ({
  createTenantStorageAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const ownerId = "550e8400-e29b-41d4-a716-446655440020";

function testRequest() {
  return new Request("http://store.localhost:3000/api/tenant/storage/test", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
    },
  });
}

describe("POST /api/tenant/storage/test", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns healthy when the storage adapter bucket check succeeds", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    createTenantStorageAdapter.mockResolvedValue({
      healthCheck: vi.fn().mockResolvedValue({
        ok: true,
        latencyMs: 42,
      }),
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "healthy",
      latencyMs: 42,
    });
    expect(createTenantStorageAdapter).toHaveBeenCalledWith(tenantId, hostId);
  });

  it("returns unhealthy details when the bucket check fails", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    createTenantStorageAdapter.mockResolvedValue({
      healthCheck: vi.fn().mockResolvedValue({
        ok: false,
        latencyMs: 18,
        details: "The configured storage bucket could not be reached.",
      }),
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unhealthy",
      latencyMs: 18,
      details: "The configured storage bucket could not be reached.",
    });
  });

  it("returns a rate-limit response before creating an adapter", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(createTenantStorageAdapter).not.toHaveBeenCalled();
  });
});
