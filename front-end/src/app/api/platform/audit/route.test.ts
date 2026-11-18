import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const session = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/session", () => ({
  getSuperAdminSession: session,
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));

describe("GET /api/platform/audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires Super Admin platform access", async () => {
    session.mockResolvedValue(null);
    const response = await GET(
      new Request("https://platform.example.com/api/platform/audit"),
    );
    expect(response.status).toBe(401);
  });

  it("exports an allowlisted audit-event set", async () => {
    session.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "super_admin",
      scope: { kind: "platform", id: "platform" },
      permissions: ["platform:read"],
    });
    store.mockReturnValue({
      listAuditEvents: vi.fn().mockResolvedValue([
        {
          id: "22222222-2222-4222-8222-222222222222",
          actorId: "11111111-1111-4111-8111-111111111111",
          scope: { kind: "platform", id: "platform" },
          action: "platform.audit.exported",
          resourceType: "audit_export",
          createdAt: "2026-11-18T00:00:00.000Z",
        },
      ]),
    });
    const response = await GET(
      new Request("https://platform.example.com/api/platform/audit?limit=10"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "platform-audit-events.json",
    );
    expect(await response.json()).toMatchObject({
      scope: { kind: "platform", id: "platform" },
      events: [{ action: "platform.audit.exported" }],
    });
  });
});
