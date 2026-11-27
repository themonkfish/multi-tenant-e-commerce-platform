import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantOwnerSession } = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));

import { GET } from "./route";

describe("GET /api/tenant/storage/oauth/google-drive/start", () => {
  afterEach(() => vi.clearAllMocks());

  it("rejects unauthenticated and unauthorized sessions", async () => {
    getTenantOwnerSession.mockResolvedValue(null);
    expect(
      (await GET(
        new Request(
          "https://store.example.test/api/tenant/storage/oauth/google-drive/start",
        ),
      )).status,
    ).toBe(401);
  });

  it("builds a signed Google authorization redirect", async () => {
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "google-secret");
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
        "https://store.example.test/api/tenant/storage/oauth/google-drive/start?folderId=folder-123&accountEmail=owner%40example.com",
      ),
    );
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("state=");
  });
});
