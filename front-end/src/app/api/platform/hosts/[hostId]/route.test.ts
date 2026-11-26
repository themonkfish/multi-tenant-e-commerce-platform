import { afterEach, describe, expect, it, vi } from "vitest";

const { getSuperAdminSession, getPlatformStore } = vi.hoisted(() => ({
  getSuperAdminSession: vi.fn(),
  getPlatformStore: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getSuperAdminSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));

import { DELETE, PATCH } from "./route";

const hostId = "11111111-1111-4111-8111-111111111111";

describe("platform host mutation scope hardening", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated host mutations", async () => {
    getSuperAdminSession.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://platform.example.com/api/platform/hosts/" + hostId, {
        method: "PATCH",
        headers: {
          host: "platform.example.com",
          origin: "http://platform.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "active" }),
      }),
      { params: Promise.resolve({ hostId }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects host-owner principals on platform mutations", async () => {
    getSuperAdminSession.mockResolvedValue({
      userId: "55555555-5555-4555-8555-555555555555",
      role: "host_owner",
      scope: { kind: "host", id: hostId },
      permissions: ["tenant:read", "tenant:write"],
    });

    const response = await DELETE(
      new Request("http://platform.example.com/api/platform/hosts/" + hostId, {
        method: "DELETE",
        headers: {
          host: "platform.example.com",
          origin: "http://platform.example.com",
        },
      }),
      { params: Promise.resolve({ hostId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});
