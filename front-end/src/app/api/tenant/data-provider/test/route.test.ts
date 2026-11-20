import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantOwnerSession, getPlatformStore, createTenantDatabaseAdapter } =
  vi.hoisted(() => ({
    getTenantOwnerSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createTenantDatabaseAdapter: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/data/database/tenant-provider-factory", () => ({
  createTenantDatabaseAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const ownerId = "550e8400-e29b-41d4-a716-446655440020";

function testRequest() {
  return new Request(
    "http://store.localhost:3000/api/tenant/data-provider/test",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
      },
    },
  );
}

describe("POST /api/tenant/data-provider/test", () => {
  afterEach(() => vi.clearAllMocks());

  it("classifies a healthy current database schema", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    createTenantDatabaseAdapter.mockResolvedValue({
      checkConnection: vi.fn().mockResolvedValue(7),
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: {
        status: "healthy",
        schemaVersion: 7,
        currentSchemaVersion: 7,
        schemaStatus: "current",
      },
    });
  });

  it("returns an unavailable schema result when connection testing fails", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    createTenantDatabaseAdapter.mockRejectedValue(
      new Error("MongoDB connection failed"),
    );

    const response = await POST(testRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      result: {
        status: "unhealthy",
        schemaVersion: null,
        currentSchemaVersion: 7,
        schemaStatus: "unavailable",
      },
    });
  });

  it("rejects rate-limited tests before creating an adapter", async () => {
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
    expect(createTenantDatabaseAdapter).not.toHaveBeenCalled();
  });
});
