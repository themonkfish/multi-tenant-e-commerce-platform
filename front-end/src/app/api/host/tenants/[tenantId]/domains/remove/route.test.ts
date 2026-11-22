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
const domain = "store.example.com";

function removeRequest() {
  return new Request(
    `http://host.localhost:3000/api/host/tenants/${tenantId}/domains/remove`,
    {
      method: "POST",
      headers: {
        host: "host.localhost:3000",
        origin: "http://host.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ domain }),
    },
  );
}

describe("POST /api/host/tenants/[tenantId]/domains/remove", () => {
  afterEach(() => vi.clearAllMocks());

  it("removes a verified tenant domain", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:write"],
    });
    const removeTenantDomain = vi.fn().mockResolvedValue({
      id: tenantId,
      hostId,
      domains: [],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      removeTenantDomain,
    });

    const response = await POST(removeRequest(), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(200);
    expect(removeTenantDomain).toHaveBeenCalledWith(
      expect.objectContaining({ hostId, tenantId, domain }),
    );
  });

  it("returns 404 when the domain is not attached", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      removeTenantDomain: vi.fn().mockResolvedValue(null),
    });

    const response = await POST(removeRequest(), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(404);
  });
});
