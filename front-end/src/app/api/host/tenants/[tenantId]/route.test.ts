import { afterEach, describe, expect, it, vi } from "vitest";

const { getHostOwnerSession, getPlatformStore } = vi.hoisted(() => ({
  getHostOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getHostOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));

import { DELETE, PATCH } from "./route";

const hostId = "11111111-1111-4111-8111-111111111111";
const tenantId = "33333333-3333-4333-8333-333333333333";
const otherHostId = "22222222-2222-4222-8222-222222222222";
const otherTenantId = "44444444-4444-4444-8444-444444444444";

function mutationRequest(body: Record<string, unknown>) {
  return new Request("http://host.example.com/api/host/tenants/" + tenantId, {
    method: "PATCH",
    headers: {
      host: "host.example.com",
      origin: "http://host.example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("host tenant mutation scope hardening", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not let a host mutate a tenant that is outside its host scope", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: "55555555-5555-4555-8555-555555555555",
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listHosts: vi.fn().mockResolvedValue([
        {
          id: hostId,
          status: "active",
        },
      ]),
      updateTenantStatus: vi.fn().mockResolvedValue(null),
      updateTenantDetails: vi.fn().mockResolvedValue(null),
    });

    const response = await PATCH(mutationRequest({ status: "active" }), {
      params: Promise.resolve({ tenantId: otherTenantId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("rejects unauthenticated tenant mutations", async () => {
    getHostOwnerSession.mockResolvedValue(null);

    const response = await PATCH(mutationRequest({ status: "suspended" }), {
      params: Promise.resolve({ tenantId }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("does not allow a host to delete a tenant outside its host scope", async () => {
    getHostOwnerSession.mockResolvedValue({
      userId: "55555555-5555-4555-8555-555555555555",
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      deleteTenantForHost: vi.fn().mockResolvedValue("not_found"),
    });

    const response = await DELETE(
      new Request("http://host.example.com/api/host/tenants/" + otherTenantId, {
        method: "DELETE",
        headers: {
          host: "host.example.com",
          origin: "http://host.example.com",
        },
      }),
      { params: Promise.resolve({ tenantId: otherTenantId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
