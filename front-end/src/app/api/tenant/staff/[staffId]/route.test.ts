import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantOwnerSession,
  getPlatformStore,
  isSameOrigin,
  createRateLimitKey,
  canAccessPermission,
  hash,
} = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  isSameOrigin: vi.fn(),
  createRateLimitKey: vi.fn(),
  canAccessPermission: vi.fn(),
  hash: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/http", () => ({ isSameOrigin, createRateLimitKey }));
vi.mock("@/core/tenancy/scope", () => ({ canAccessPermission }));
vi.mock("@node-rs/argon2", () => ({ hash }));

import { DELETE, PATCH } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const staffId = "550e8400-e29b-41d4-a716-446655440020";
const staff = {
  id: staffId,
  tenantId,
  hostId,
  email: "staff@example.com",
  passwordHash: "hashed",
  permissions: ["catalog:read" as const],
  active: true,
  createdAt: "2026-10-24T12:00:00.000Z",
};

function setupStore(overrides: Record<string, unknown> = {}) {
  const store = {
    consumeRateLimit: vi.fn().mockResolvedValue(true),
    updateTenantStaff: vi.fn().mockResolvedValue(staff),
    deleteTenantStaff: vi.fn().mockResolvedValue(true),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  getPlatformStore.mockReturnValue(store);
  getTenantOwnerSession.mockResolvedValue({
    userId: "550e8400-e29b-41d4-a716-446655440030",
    role: "tenant_owner",
    scope: { kind: "tenant", id: tenantId, hostId },
    permissions: ["staff:manage"],
  });
  canAccessPermission.mockReturnValue(true);
  isSameOrigin.mockReturnValue(true);
  createRateLimitKey.mockReturnValue("staff-rate-key");
  hash.mockResolvedValue("argon-hash");
  return store;
}

function request(method: string, body?: unknown) {
  return new Request("https://store.example.com/api/tenant/staff", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://store.example.com",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const context = { params: Promise.resolve({ staffId }) };

describe("tenant staff account management", () => {
  afterEach(() => vi.clearAllMocks());

  it("updates permissions and automatically includes required read access", async () => {
    const store = setupStore({
      updateTenantStaff: vi.fn().mockResolvedValue({
        ...staff,
        permissions: ["catalog:read", "catalog:write"],
      }),
    });
    const response = await PATCH(
      request("PATCH", { permissions: ["catalog:write"] }),
      context,
    );

    expect(response.status).toBe(200);
    expect(store.updateTenantStaff).toHaveBeenCalledWith({
      staffId,
      tenantId,
      permissions: ["catalog:write", "catalog:read"],
    });
    expect(store.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.staff.permissions_updated",
        resourceId: staffId,
      }),
    );
  });

  it("does not permit removing every permission", async () => {
    const store = setupStore();
    const response = await PATCH(
      request("PATCH", { permissions: [] }),
      context,
    );

    expect(response.status).toBe(400);
    expect(store.updateTenantStaff).not.toHaveBeenCalled();
  });

  it("deletes a staff account in tenant scope and records an audit event", async () => {
    const store = setupStore();
    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(store.deleteTenantStaff).toHaveBeenCalledWith(staffId, tenantId);
    expect(store.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.staff.deleted",
        resourceType: "tenant_staff",
        resourceId: staffId,
      }),
    );
  });

  it("returns not found for a staff account outside the tenant", async () => {
    const store = setupStore({
      deleteTenantStaff: vi.fn().mockResolvedValue(false),
    });
    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(404);
    expect(store.appendAuditEvent).not.toHaveBeenCalled();
  });
});
