import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantOwnerSession } = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));

import { GET } from "./route";

describe("GET /api/tenant/storage/oauth/onedrive/start", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires an authenticated tenant writer", async () => {
    getTenantOwnerSession.mockResolvedValue(null);
    const response = await GET(
      new Request(
        "https://store.example.test/api/tenant/storage/oauth/onedrive/start",
      ),
    );
    expect(response.status).toBe(401);
  });

  it("redirects to Microsoft with signed state", async () => {
    vi.stubEnv("ONEDRIVE_CLIENT_ID", "onedrive-client");
    vi.stubEnv("ONEDRIVE_CLIENT_SECRET", "onedrive-secret");
    vi.stubEnv("ONEDRIVE_TENANT_ID", "common");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: {
        kind: "tenant",
        id: "550e8400-e29b-41d4-a716-446655440000",
        hostId: "550e8400-e29b-41d4-a716-446655440010",
      },
      permissions: ["tenant:write"],
    });
    const response = await GET(
      new Request(
        "https://store.example.test/api/tenant/storage/oauth/onedrive/start?folderId=%2FTenantAssets",
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "login.microsoftonline.com",
    );
  });
});
