import "server-only";
import type { CustomerOrder } from "@/core/domain/tenant-identities";

export type ShipmentPackage = {
  weightKg: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

export type BlueDartCredentials = {
  baseUrl: string;
  customerCode: string;
  loginId: string;
  licenseKey: string;
};

export type CreatedShipment = {
  carrier: "BlueDart";
  trackingNumber: string;
  trackingUrl: string;
  labelUrl?: string;
};

function validatePackage(packageDetails: ShipmentPackage): void {
  if (
    !Number.isFinite(packageDetails.weightKg) ||
    packageDetails.weightKg <= 0 ||
    packageDetails.weightKg > 100 ||
    ![
      packageDetails.lengthCm,
      packageDetails.breadthCm,
      packageDetails.heightCm,
    ].every((value) => Number.isFinite(value) && value > 0 && value <= 1000)
  ) {
    throw new Error("invalid_shipment_package");
  }
}

async function providerRequest(
  credentials: BlueDartCredentials,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; body: unknown }> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(credentials.baseUrl);
  } catch {
    throw new Error("bluedart_invalid_base_url");
  }
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search
  ) {
    throw new Error("bluedart_invalid_base_url");
  }
  if (
    !credentials.customerCode.trim() ||
    !credentials.loginId.trim() ||
    !credentials.licenseKey.trim()
  ) {
    throw new Error("bluedart_credentials_required");
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const responseUrl = new URL(normalizedPath, `${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, "")}/`);
  let response: Response;
  try {
    response = await fetch(responseUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bluedart-customer-code": credentials.customerCode,
        "x-bluedart-login-id": credentials.loginId,
        "x-bluedart-license-key": credentials.licenseKey,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error("bluedart_timeout");
    }
    throw new Error("bluedart_unavailable");
  }
  const responseBody: unknown = await response.json().catch(() => null);
  if (
    response.ok &&
    (responseBody === null ||
      typeof responseBody !== "object" ||
      Array.isArray(responseBody))
  ) {
    throw new Error("bluedart_malformed_response");
  }
  return { ok: response.ok, body: responseBody };
}

export async function createBlueDartShipment(input: {
  credentials: BlueDartCredentials;
  order: CustomerOrder;
  package: ShipmentPackage;
}): Promise<CreatedShipment> {
  validatePackage(input.package);
  if (!input.order.deliveryAddress) {
    throw new Error("delivery_address_required");
  }
  const address = input.order.deliveryAddress;
  const result = await providerRequest(
    input.credentials,
    "/Shipment/WaybillGeneration",
    {
      referenceNumber: input.order.id,
      package: input.package,
      codAmount:
        input.order.paymentMethod === "cash_on_delivery"
          ? input.order.total / 100
          : 0,
      consignee: {
        name: address.fullName,
        address: [address.line1, address.line2].filter(Boolean).join(", "),
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: "IN",
        phone: address.phone,
      },
      items: input.order.items.map((item) => ({
        name: item.title,
        sku: item.sku ?? item.productId,
        quantity: item.quantity,
        value: item.unitPrice / 100,
      })),
    },
  );
  if (!result.ok) {
    throw new Error("bluedart_create_failed");
  }
  const body = result.body as {
    awb?: string;
    waybillNumber?: string;
    awbNumber?: string;
    trackingNumber?: string;
    labelUrl?: string;
    labelUrlPdf?: string;
  };
  const trackingNumber =
    body.awb ??
    body.waybillNumber ??
    body.awbNumber ??
    body.trackingNumber;
  if (!trackingNumber?.trim()) {
    throw new Error("bluedart_awb_missing");
  }
  const normalizedAwb = trackingNumber.trim();
  if (
    normalizedAwb.length > 120 ||
    /[\r\n]/.test(normalizedAwb)
  ) {
    throw new Error("bluedart_malformed_response");
  }
  let labelUrl: string | undefined;
  const candidateLabelUrl = body.labelUrlPdf ?? body.labelUrl;
  if (candidateLabelUrl) {
    try {
      const parsed = new URL(candidateLabelUrl);
      if (parsed.protocol === "https:") labelUrl = parsed.toString();
    } catch {
      labelUrl = undefined;
    }
  }
  return {
    carrier: "BlueDart",
    trackingNumber: trackingNumber.trim(),
    trackingUrl: `https://www.bluedart.com/tracking?awb=${encodeURIComponent(trackingNumber.trim())}`,
    ...(labelUrl ? { labelUrl } : {}),
  };
}

export async function cancelBlueDartShipment(input: {
  credentials: BlueDartCredentials;
  awb: string;
}): Promise<void> {
  const awb = input.awb.trim();
  if (!/^.{1,120}$/.test(awb)) {
    throw new Error("invalid_tracking_number");
  }
  const result = await providerRequest(
    input.credentials,
    "/Shipment/Cancel",
    { awb },
  );
  if (!result.ok) {
    throw new Error("bluedart_cancellation_failed");
  }
}
