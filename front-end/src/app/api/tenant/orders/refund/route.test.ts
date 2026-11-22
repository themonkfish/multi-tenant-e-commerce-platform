import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantPortalSession, getPlatformStore, createStripeRefund } =
  vi.hoisted(() => ({
    getTenantPortalSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createStripeRefund: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/lib/server/stripe-payments", () => ({ createStripeRefund }));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440001";

function refundRequest() {
  return new Request("http://store.localhost:3000/api/tenant/orders/refund", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ orderId }),
  });
}

describe("POST /api/tenant/orders/refund", () => {
  afterEach(() => vi.clearAllMocks());

  it("requests a full refund for an authorized paid Stripe order", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write", "orders:write"],
    });
    const order = {
      id: orderId,
      tenantId,
      customerId: "550e8400-e29b-41d4-a716-446655440030",
      status: "Confirmed",
      paymentMethod: "stripe",
      paymentStatus: "paid",
      paymentIntentId: "pi_test_1",
      total: 2500,
      items: [],
    };
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([order]),
      appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    });
    createStripeRefund.mockResolvedValue({
      id: "re_test_1",
      status: "succeeded",
    });

    const response = await POST(refundRequest());

    expect(response.status).toBe(200);
    expect(createStripeRefund).toHaveBeenCalledWith({
      order,
      paymentIntentId: "pi_test_1",
    });
  });

  it("rejects a COD or unpaid order", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId: "550e8400-e29b-41d4-a716-446655440020",
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["orders:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      listTenantOrders: vi.fn().mockResolvedValue([
        {
          id: orderId,
          paymentMethod: "cash_on_delivery",
          paymentStatus: "cod_due",
        },
      ]),
    });

    const response = await POST(refundRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "order_not_refundable" });
  });
});
