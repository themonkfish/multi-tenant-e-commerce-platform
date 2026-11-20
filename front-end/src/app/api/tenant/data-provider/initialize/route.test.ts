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

function initializeRequest() {
  return new Request(
    "http://store.localhost:3000/api/tenant/data-provider/initialize",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
      },
    },
  );
}

describe("POST /api/tenant/data-provider/initialize", () => {
  afterEach(() => vi.clearAllMocks());

  it("initializes the schema and appends an audit event", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    createTenantDatabaseAdapter.mockResolvedValue({
      initializeSchema: vi.fn().mockResolvedValue(7),
    });

    const response = await POST(initializeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 7,
      status: "current",
    });
  });

  it("returns 409 when the provider schema requires a platform upgrade", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    const upgradeError = Object.assign(new Error("Schema too new"), {
      status: 409,
    });
    createTenantDatabaseAdapter.mockResolvedValue({
      initializeSchema: vi.fn().mockRejectedValue(upgradeError),
    });

    const response = await POST(initializeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "schema_upgrade_required",
    });
  });

  it("rejects rate-limited initialization before creating an adapter", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(initializeRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(createTenantDatabaseAdapter).not.toHaveBeenCalled();
  });
});
