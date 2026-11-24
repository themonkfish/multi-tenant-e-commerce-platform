import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import { createShiprocketShipment } from "./shiprocket-shipments";

const order = {
  id: "ORD-550e8400-e29b-41d4-a716-446655440001",
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
  customerId: "550e8400-e29b-41d4-a716-446655440002",
  status: "Processing",
  createdAt: "2026-11-24T10:00:00.000Z",
  items: [
    {
      productId: "product-1",
      title: "Test product",
      slug: "test-product",
      quantity: 2,
      unitPrice: 500,
      currency: "INR",
    },
  ],
  subtotal: 1000,
  shippingAmount: 0,
  taxAmount: 0,
  taxRateBasisPoints: 0,
  discountAmount: 0,
  total: 1000,
  currency: "INR",
  itemCount: 2,
  paymentMethod: "cash_on_delivery",
  paymentStatus: "cod_due",
  paymentAttempt: 0,
  backendSyncStatus: "synced",
  deliveryAddress: {
    fullName: "Test Customer",
    line1: "1 Test Road",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    country: "IN",
    phone: "+919876543210",
  },
} satisfies CustomerOrder;

describe("Shiprocket shipment creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates and creates a COD shipment with AWB and label calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            shipment_id: 123,
            awb_code: "AWB123",
            courier_name: "Delhivery",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "success" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createShiprocketShipment({
        credentials: {
          email: "api@example.com",
          password: "secret",
          pickupLocation: "Primary",
        },
        order,
        package: {
          weightKg: 1,
          lengthCm: 20,
          breadthCm: 15,
          heightCm: 10,
        },
      }),
    ).resolves.toEqual({
      carrier: "Delhivery",
      trackingNumber: "AWB123",
      trackingUrl: "https://shiprocket.co/tracking/AWB123",
    });

    const createRequest = vi.mocked(fetchMock).mock.calls[1];
    expect(createRequest[0]).toContain("/v1/external/orders/create/adhoc");
    expect(JSON.parse(String(createRequest[1]?.body))).toMatchObject({
      order_id: order.id,
      payment_method: "COD",
      pickup_location: "Primary",
      weight: 1,
    });
  });

  it("requires login and rejects failed authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "invalid" }), { status: 401 }),
      ),
    );

    await expect(
      createShiprocketShipment({
        credentials: {
          email: "api@example.com",
          password: "wrong",
          pickupLocation: "Primary",
        },
        order,
        package: {
          weightKg: 1,
          lengthCm: 20,
          breadthCm: 15,
          heightCm: 10,
        },
      }),
    ).rejects.toThrow("shiprocket_auth_failed");
  });
});
