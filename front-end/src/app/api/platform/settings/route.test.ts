import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";

const session = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/session", () => ({
  getSuperAdminSession: session,
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));

describe("platform settings routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires Super Admin access", async () => {
    session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("gets and updates validated platform settings", async () => {
    session.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "super_admin",
      scope: { kind: "platform", id: "platform" },
      permissions: ["platform:read", "platform:write"],
    });
    const updatePlatformSettings = vi.fn().mockResolvedValue({
      name: "Updated Platform",
      primaryColor: "#123456",
      accentColor: "#654321",
      termsUrl: "https://platform.example.com/terms",
    });
    store.mockReturnValue({
      getSetupState: vi.fn().mockResolvedValue({
        initialized: true,
        reservedSubdomains: ["admin"],
        settings: {
          name: "Example Platform",
          primaryColor: "#4338CA",
          accentColor: "#0F766E",
        },
      }),
      updatePlatformSettings,
    });

    const getResponse = await GET();
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      settings: { name: "Example Platform" },
    });

    const patchResponse = await PATCH(
      new Request("https://platform.example.com/api/platform/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://platform.example.com",
          host: "platform.example.com",
        },
        body: JSON.stringify({
          name: "Updated Platform",
          primaryColor: "#123456",
          accentColor: "#654321",
          termsUrl: "https://platform.example.com/terms",
        }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    expect(updatePlatformSettings).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Updated Platform" }),
      expect.objectContaining({ action: "platform.settings.updated" }),
    );
  });
});
