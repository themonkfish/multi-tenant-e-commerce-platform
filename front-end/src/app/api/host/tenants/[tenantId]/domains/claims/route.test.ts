import { afterEach, describe, expect, it, vi } from "vitest";

const { getHostOwnerSession, getPlatformStore } = vi.hoisted(() => ({
  getHostOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getHostOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));

import { POST } from "./route";

const hostId = "550e8400-e29b-41d4-a716-446655440010";
const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const ownerId = "550e8400-e29b-41d4-a716-446655440020";

function claimRequest() {
  return new Request(
    `http://host.localhost:3000/api/host/tenants/${tenantId}/domains/claims`,
    {
      method: "POST",
      headers: {
        host: "host.localhost:3000",
        origin: "http://host.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ domain: "Store.Example.com" }),
    },
  );
}

describe("POST /api/host/tenants/[tenantId]/domains/claims", () => {
  afterEach(() => vi.clearAllMocks());

  it("cancels a pending tenant domain claim", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:write"],
    });
    const removeTenantDomainClaim = vi.fn().mockResolvedValue(true);
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      removeTenantDomainClaim,
    });

    const response = await POST(claimRequest(), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(removeTenantDomainClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId,
        tenantId,
        domain: "store.example.com",
        auditEvent: expect.objectContaining({
          action: "tenant.domain_claim_removed",
        }),
      }),
    );
  });

  it("returns 404 when the pending claim does not exist", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      removeTenantDomainClaim: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(claimRequest(), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "domain_claim_not_found",
    });
  });

  it("rejects a host that lacks tenant write permission", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:read"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });

    const response = await POST(claimRequest(), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(403);
  });
});
