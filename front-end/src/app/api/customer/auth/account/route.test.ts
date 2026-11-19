import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "./route";

const session = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/session", () => ({
  getCustomerSession: session,
  getCustomerCookieName: () => "store-customer",
  customerCookieOptions: () => ({ httpOnly: true }),
}));
vi.mock("@/lib/server/platform", () => ({
  getPlatformStore: store,
}));

describe("DELETE /api/customer/auth/account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated Customer", async () => {
    session.mockResolvedValue(null);
    const response = await DELETE(
      new Request("https://store.example.com/api/customer/auth/account", {
        method: "DELETE",
        headers: {
          origin: "https://store.example.com",
          host: "store.example.com",
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("deletes the scoped account, orders, and audit event", async () => {
    session.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440001",
      role: "customer",
      scope: {
        kind: "tenant",
        id: "550e8400-e29b-41d4-a716-446655440002",
        hostId: "550e8400-e29b-41d4-a716-446655440003",
      },
      permissions: ["customer:orders:read"],
    });
    const deleteCustomerAccount = vi.fn().mockResolvedValue(true);
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    store.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      deleteCustomerAccount,
      appendAuditEvent,
    });

    const response = await DELETE(
      new Request("https://store.example.com/api/customer/auth/account", {
        method: "DELETE",
        headers: {
          origin: "https://store.example.com",
          host: "store.example.com",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(deleteCustomerAccount).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440001",
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer.account.deleted",
        resourceType: "customer_account",
      }),
    );
  });
});
