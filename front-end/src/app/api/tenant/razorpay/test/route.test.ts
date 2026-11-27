import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantOwnerSession,
  getPlatformStore,
  getSecretVault,
  testRazorpayConnection,
} = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getSecretVault: vi.fn(),
  testRazorpayConnection: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore,
  getSecretVault,
}));
vi.mock("@/lib/server/razorpay-payments", () => ({
  testRazorpayConnection,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";

function testRequest() {
  return new Request(
    "http://store.localhost:3000/api/tenant/razorpay/test",
    {
      method: "POST",
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
      },
    },
  );
}

describe("POST /api/tenant/razorpay/test", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires tenant write permission", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read"],
    });
    const response = await POST(testRequest());
    expect(response.status).toBe(403);
  });

  it("rejects unconfigured Razorpay credentials", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        payments: { stripe: true, razorpay: false, cashOnDelivery: false },
      }),
    });
    const response = await POST(testRequest());
    expect(response.status).toBe(409);
  });

  it("reports a healthy tenant credential probe", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
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
    });
    getSecretVault.mockReturnValue({
      getSecret: vi.fn().mockResolvedValue(
        JSON.stringify({
          keyId: "rzp_test_123",
          keySecret: "key-secret",
          webhookSecret: "at-least-16-char-secret",
        }),
      ),
    });
    testRazorpayConnection.mockResolvedValue({
      status: "healthy",
      latencyMs: 42,
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { status: "healthy", latencyMs: 42 },
    });
  });

  it("reports an unhealthy stale secret", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      getTenantStoreSettings: vi.fn().mockResolvedValue({
        payments: {
          razorpay: true,
          razorpayConfig: {
            keyId: "rzp_test_123",
            credentialsRef: "missing-secret",
          },
        },
      }),
    });
    getSecretVault.mockReturnValue({
      getSecret: vi.fn().mockRejectedValue(new Error("not found")),
    });

    const response = await POST(testRequest());

    expect(response.status).toBe(502);
  });
});
