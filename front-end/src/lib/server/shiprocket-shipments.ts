import "server-only";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

const SHIPROCKET_API = "https://apiv2.shiprocket.in";

type ShiprocketCredentials = {
  email: string;
  password: string;
  pickupLocation: string;
};

export type ShipmentPackage = {
  weightKg: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

export type CreatedShipment = {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
};

async function shiprocketFetch(
  path: string,
  token: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${SHIPROCKET_API}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

export async function createShiprocketShipment(input: {
  credentials: ShiprocketCredentials;
  order: CustomerOrder;
  package: ShipmentPackage;
}): Promise<CreatedShipment> {
  if (
    !Number.isFinite(input.package.weightKg) ||
    input.package.weightKg <= 0 ||
    input.package.weightKg > 100 ||
    ![input.package.lengthCm, input.package.breadthCm, input.package.heightCm].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 1000,
    )
  ) {
    throw new Error("invalid_shipment_package");
  }

  const login = await fetch(`${SHIPROCKET_API}/v1/external/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      email: input.credentials.email,
      password: input.credentials.password,
    }),
  });
  const loginBody = (await login.json().catch(() => null)) as
    | { token?: string }
    | null;
  if (!login.ok || !loginBody?.token) {
    throw new Error("shiprocket_auth_failed");
  }

  const address = input.order.deliveryAddress;
  if (!address) {
    throw new Error("delivery_address_required");
  }
  const isCod = input.order.paymentMethod === "cash_on_delivery";
  const createResponse = await shiprocketFetch(
    "/v1/external/orders/create/adhoc",
    loginBody.token,
    {
      method: "POST",
      body: JSON.stringify({
        order_id: input.order.id,
        order_date: input.order.createdAt.slice(0, 10),
        pickup_location: input.credentials.pickupLocation,
        billing_customer_name: address.fullName,
        billing_last_name: "",
        billing_address: [address.line1, address.line2].filter(Boolean).join(", "),
        billing_city: address.city,
        billing_pincode: address.postalCode,
        billing_state: address.state,
        billing_country: "India",
        billing_email: "",
        billing_phone: address.phone.replace(/^\+91/, ""),
        shipping_is_billing: true,
        order_items: input.order.items.map((item) => ({
          name: item.title,
          sku: item.sku ?? item.productId,
          units: item.quantity,
          selling_price: (item.unitPrice / 100).toFixed(2),
        })),
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: (
          (input.order.subtotal ?? input.order.total) / 100
        ).toFixed(2),
        length: input.package.lengthCm,
        breadth: input.package.breadthCm,
        height: input.package.heightCm,
        weight: input.package.weightKg,
      }),
    },
  );
  if (!createResponse.ok) {
    throw new Error("shiprocket_create_failed");
  }

  const created = createResponse.body as {
    shipment_id?: number | string;
    awb_code?: string;
    courier_name?: string;
  };
  const shipmentId = created.shipment_id?.toString();
  if (!shipmentId) {
    throw new Error("shiprocket_shipment_id_missing");
  }
  let awb = created.awb_code?.trim();
  let carrier = created.courier_name?.trim();

  if (!awb) {
    const awbResponse = await shiprocketFetch(
      "/v1/external/courier/awb",
      loginBody.token,
      {
        method: "POST",
        body: JSON.stringify({ shipment_id: Number(shipmentId) }),
      },
    );
    if (!awbResponse.ok) {
      throw new Error("shiprocket_awb_failed");
    }
    const awbBody = awbResponse.body as {
      response?: { data?: { awb_code?: string; courier_name?: string } };
      awb_code?: string;
      courier_name?: string;
    };
    awb =
      awbBody.response?.data?.awb_code ??
      awbBody.awb_code ??
      undefined;
    awb = awb?.trim() || undefined;
    carrier =
      awbBody.response?.data?.courier_name ??
      awbBody.courier_name ??
      carrier;
  }
  if (!awb) {
    throw new Error("shiprocket_awb_missing");
  }

  const labelResponse = await shiprocketFetch(
    "/v1/external/courier/generate/label",
    loginBody.token,
    {
      method: "POST",
      body: JSON.stringify({ shipment_id: [Number(shipmentId)] }),
    },
  );
  if (!labelResponse.ok) {
    throw new Error("shiprocket_label_failed");
  }

  return {
    carrier: carrier || "Shiprocket",
    trackingNumber: awb,
    trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`,
  };
}
