import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantOwnerSession,
  getPlatformStore,
  getSecretVault,
} = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getSecretVault: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore,
  getSecretVault,
}));

import { PUT, DELETE } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";

function request(method: "PUT" | "DELETE", body?: unknown) {
  return new Request(
    "http://store.localhost:3000/api/tenant/razorpay",
    {
      method,
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

describe("/api/tenant/razorpay", () => {
  afterEach(() => vi.clearAllMocks());

  it("stores Razorpay credentials encrypted and enables the tenant method", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:write"],
    });
    const settings = {
      payments: { stripe: true, razorpay: false, cashOnDelivery: false },
    };
    const putSecret = vi.fn().mockResolvedValue("secret-ref");
    const deleteSecret = vi.fn().mockResolvedValue(undefined);
    getSecretVault.mockReturnValue({ putSecret, deleteSecret });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getTenantStoreSettings: vi.fn().mockResolvedValue(settings),
      updateTenantStoreSettings: vi.fn().mockResolvedValue(settings),
    });

    const response = await PUT(
      request("PUT", {
        keyId: "rzp_test_123",
        keySecret: "key-secret",
        webhookSecret: "at-least-16-char-secret",
      }),
    );

    expect(response.status).toBe(200);
    expect(putSecret).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, name: "tenant-razorpay-credentials" }),
    );
  });

  it("requires the tenant write permission", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read"],
    });
    const response = await PUT(
      request("PUT", {
        keyId: "rzp_test_123",
        keySecret: "key-secret",
        webhookSecret: "at-least-16-char-secret",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("removes configured Razorpay credentials", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:write"],
    });
    const deleteSecret = vi.fn().mockResolvedValue(undefined);
    getSecretVault.mockReturnValue({ deleteSecret });
    getPlatformStore.mockReturnValue({
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        payments: {
          stripe: true,
          razorpay: true,
          cashOnDelivery: false,
          razorpayConfig: {
            keyId: "rzp_test_123",
            credentialsRef: "secret-ref",
          },
        },
      }),
      updateTenantStoreSettings: vi.fn().mockResolvedValue({
        payments: { stripe: true, razorpay: false, cashOnDelivery: false },
      }),
    });

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(200);
    expect(deleteSecret).toHaveBeenCalledWith("secret-ref");
  });
});
