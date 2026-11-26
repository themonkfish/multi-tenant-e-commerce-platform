import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import {
  cancelBlueDartShipment,
  createBlueDartShipment,
} from "./bluedart-shipments";

const order = {
  id: "ORD-550e8400-e29b-41d4-a716-446655440001",
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
  customerId: "550e8400-e29b-41d4-a716-446655440002",
  status: "Processing",
  createdAt: "2026-11-24T10:00:00.000Z",
  items: [],
  total: 1000,
  currency: "INR",
  itemCount: 1,
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

describe("BlueDart shipment creation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a shipment and returns an HTTPS BlueDart tracking link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            awbNumber: "BD123",
            labelUrlPdf: "https://cdn.example.com/BD123.pdf",
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
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
      carrier: "BlueDart",
      trackingNumber: "BD123",
      trackingUrl: "https://www.bluedart.com/tracking?awb=BD123",
      labelUrl: "https://cdn.example.com/BD123.pdf",
    });
  });

  it("rejects invalid package dimensions", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        order,
        package: {
          weightKg: 0,
          lengthCm: 20,
          breadthCm: 15,
          heightCm: 10,
        },
      }),
    ).rejects.toThrow("invalid_shipment_package");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels an AWB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }),
      ),
    );
    await expect(
      cancelBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        awb: "BD123",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an HTTP or base-URL configuration failure without parsing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "http://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        order,
        package: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
      }),
    ).rejects.toThrow("bluedart_invalid_base_url");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps timed-out provider requests to a stable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timeout", "TimeoutError")),
    );
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        order,
        package: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
      }),
    ).rejects.toThrow("bluedart_timeout");
  });

  it("rejects malformed successful provider payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify("not-an-object"), { status: 200 }),
      ),
    );
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        order,
        package: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
      }),
    ).rejects.toThrow("bluedart_malformed_response");
  });

  it("rejects a successful payload with no usable AWB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ awb: "  " }), { status: 200 }),
      ),
    );
    await expect(
      createBlueDartShipment({
        credentials: {
          baseUrl: "https://api.example.com",
          customerCode: "CUSTOMER",
          loginId: "LOGIN",
          licenseKey: "LICENSE",
        },
        order,
        package: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
      }),
    ).rejects.toThrow("bluedart_awb_missing");
  });
});
