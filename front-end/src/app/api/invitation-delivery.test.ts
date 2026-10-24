import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getPlatformStore,
  getSuperAdminSession,
  getHostOwnerSession,
  sendInvitationEmail,
  isSameOrigin,
  canAccessPermission,
  hashToken,
  createRateLimitKey,
} = vi.hoisted(() => ({
  getPlatformStore: vi.fn(),
  getSuperAdminSession: vi.fn(),
  getHostOwnerSession: vi.fn(),
  sendInvitationEmail: vi.fn(),
  isSameOrigin: vi.fn(),
  canAccessPermission: vi.fn(),
  hashToken: vi.fn(),
  createRateLimitKey: vi.fn(),
}));

vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/session", () => ({
  getSuperAdminSession,
  getHostOwnerSession,
}));
vi.mock("@/lib/server/invitation-email", () => ({ sendInvitationEmail }));
vi.mock("@/lib/server/http", () => ({ isSameOrigin, createRateLimitKey }));
vi.mock("@/lib/server/crypto", () => ({ hashToken }));
vi.mock("@/core/tenancy/scope", () => ({ canAccessPermission }));

import { POST as inviteHostOwner } from "./platform/hosts/[hostId]/invite/route";
import { POST as inviteTenantOwner } from "./host/tenants/[tenantId]/invite/route";

const hostId = "550e8400-e29b-41d4-a716-446655440010";
const tenantId = "550e8400-e29b-41d4-a716-446655440000";

function inviteRequest() {
  return new Request("https://platform.example.com/api/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Owner@Example.com" }),
  });
}

describe("invitation email delivery", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps the host invitation link available if email delivery fails", async () => {
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listHosts: vi.fn().mockResolvedValue([{ id: hostId }]),
      createHostOwnerInvite: vi.fn().mockResolvedValue(undefined),
      getSetupState: vi.fn().mockResolvedValue({
        platformDomain: "platform.example.com",
      }),
    };
    getPlatformStore.mockReturnValue(store);
    getSuperAdminSession.mockResolvedValue({ userId: "admin-1" });
    canAccessPermission.mockReturnValue(true);
    isSameOrigin.mockReturnValue(true);
    createRateLimitKey.mockReturnValue("invite-rate-key");
    hashToken.mockReturnValue("token-hash");
    sendInvitationEmail.mockResolvedValue("failed");

    const response = await inviteHostOwner(inviteRequest(), {
      params: Promise.resolve({ hostId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      inviteUrl: expect.stringMatching(
        /^https:\/\/platform\.example\.com\/en\/host\/accept-invite\?token=/,
      ),
      deliveryStatus: "failed",
    });
    expect(store.createHostOwnerInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@example.com" }),
      expect.any(Object),
    );
    expect(sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "host_owner",
        to: "owner@example.com",
        inviteUrl: body.inviteUrl,
      }),
    );
  });

  it("sends a tenant-owner invitation and returns its delivery status", async () => {
    const store = {
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantsForHost: vi
        .fn()
        .mockResolvedValue([{ id: tenantId, hostId, status: "active" }]),
      createTenantOwnerInvite: vi.fn().mockResolvedValue(undefined),
      getSetupState: vi.fn().mockResolvedValue({
        platformDomain: "platform.example.com",
      }),
    };
    getPlatformStore.mockReturnValue(store);
    getHostOwnerSession.mockResolvedValue({
      userId: "host-owner-1",
      scope: { kind: "host", id: hostId },
    });
    canAccessPermission.mockReturnValue(true);
    isSameOrigin.mockReturnValue(true);
    createRateLimitKey.mockReturnValue("invite-rate-key");
    hashToken.mockReturnValue("token-hash");
    sendInvitationEmail.mockResolvedValue("sent");

    const response = await inviteTenantOwner(inviteRequest(), {
      params: Promise.resolve({ tenantId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      inviteUrl: expect.stringMatching(
        /^https:\/\/platform\.example\.com\/en\/tenant\/accept-invite\?token=/,
      ),
      deliveryStatus: "sent",
    });
    expect(sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "tenant_owner",
        to: "owner@example.com",
        inviteUrl: body.inviteUrl,
      }),
    );
  });
});
