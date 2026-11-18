import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const session = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/session", () => ({
  getTenantOwnerSession: session,
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));

describe("POST /api/tenant/export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires tenant owner access", async () => {
    session.mockResolvedValue(null);
    const response = await POST(
      new Request("https://store.example.com/api/tenant/export", {
        method: "POST",
        headers: {
          origin: "https://store.example.com",
          host: "store.example.com",
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns a secret-free tenant JSON export", async () => {
    session.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "tenant_owner",
      scope: {
        kind: "tenant",
        id: "22222222-2222-4222-8222-222222222222",
        hostId: "33333333-3333-4333-8333-333333333333",
      },
      permissions: ["settings:read"],
    });
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      hostId: "33333333-3333-4333-8333-333333333333",
      slug: "sample",
      name: "Sample",
      status: "active",
      plan: "starter",
      domains: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    store.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantsForHost: vi.fn().mockResolvedValue([tenant]),
      getTenantStoreSettings: vi.fn().mockResolvedValue({ branding: {} }),
      listTenantStaff: vi.fn().mockResolvedValue([]),
      getTenantOwnerByTenant: vi.fn().mockResolvedValue(null),
      getTenantRestConnection: vi.fn().mockResolvedValue({
        baseUrl: "https://tenant.example.com",
        apiVersion: "v1",
        apiKeyRef: "secret-ref",
      }),
      getTenantDatabaseProvider: vi.fn().mockResolvedValue(null),
      getTenantStorageProvider: vi.fn().mockResolvedValue(null),
      listTenantOrders: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue([]),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    const response = await POST(
      new Request("https://store.example.com/api/tenant/export", {
        method: "POST",
        headers: {
          origin: "https://store.example.com",
          host: "store.example.com",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "tenant-sample-export.json",
    );
    const body = await response.text();
    expect(body).not.toContain("secret-ref");
    expect(JSON.parse(body)).toMatchObject({
      tenant: { slug: "sample" },
      connections: {
        rest: {
          type: "rest",
          baseUrl: "https://tenant.example.com",
          apiVersion: "v1",
        },
      },
    });
  });
});
