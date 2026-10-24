import "server-only";
import { z } from "zod";
import {
  CustomerOrderSchema,
  TenantOrderSchema,
  type CustomerOrder,
  type TenantOrder,
} from "@/core/domain/tenant-identities";
import type { TenantRestDataProviderConfig } from "@/core/domain/tenant-config";
import {
  requestSafeRestBackend,
  type RestHttpRequest,
  type RestHttpResponse,
} from "./safe-http";
import { RestBackendError } from "./catalog-adapter";

type RestTransport = (
  config: TenantRestDataProviderConfig,
  apiKey: string,
  request: RestHttpRequest,
) => Promise<RestHttpResponse>;

const OrderResponseSchema = TenantOrderSchema;
const OrderPageSchema = z.object({
  data: z.array(TenantOrderSchema),
  meta: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});

export class RestTenantOrderAdapter {
  constructor(
    private readonly config: TenantRestDataProviderConfig,
    private readonly apiKey: string,
    private readonly tenantId: string,
    private readonly transport: RestTransport = requestSafeRestBackend,
  ) {}

  async createOrder(input: CustomerOrder): Promise<void> {
    const order = CustomerOrderSchema.parse(input);
    this.assertTenant(order.tenantId);
    const paymentConfirmed =
      order.paymentStatus === "paid" ||
      (order.paymentMethod === "cash_on_delivery" &&
        order.paymentStatus === "cod_due");
    if (!paymentConfirmed) {
      throw new Error(
        "Tenant backend orders must be paid or accepted cash-on-delivery orders",
      );
    }
    const response = await this.transport(this.config, this.apiKey, {
      method: "POST",
      path: "/orders",
      body: {
        id: order.id,
        tenantId: order.tenantId,
        customerId: order.customerId,
        status: order.status,
        createdAt: order.createdAt,
        items: order.items,
        ...(order.subtotal !== undefined ? { subtotal: order.subtotal } : {}),
        ...(order.shippingAmount !== undefined
          ? { shippingAmount: order.shippingAmount }
          : {}),
        ...(order.discountCode ? { discountCode: order.discountCode } : {}),
        ...(order.discountAmount !== undefined
          ? { discountAmount: order.discountAmount }
          : {}),
        total: order.total,
        currency: order.currency,
        itemCount: order.itemCount,
        paymentMethod: order.paymentMethod,
        ...(order.deliveryAddress
          ? { deliveryAddress: order.deliveryAddress }
          : {}),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new RestBackendError(
        response.status,
        response.status === 401 || response.status === 403
          ? "Tenant backend rejected the configured API key"
          : response.status === 409
            ? "Tenant backend reported an order conflict"
            : response.status === 422
              ? "Tenant backend rejected the order data"
              : response.status >= 500
                ? "Tenant backend encountered an error"
                : `Tenant backend returned HTTP ${response.status}`,
      );
    }
    const result = OrderResponseSchema.parse(
      typeof response.body === "object" &&
        response.body !== null &&
        "order" in response.body
        ? response.body.order
        : null,
    );
    if (result.id !== order.id || result.tenantId !== this.tenantId) {
      throw new Error("Tenant backend returned a mismatched order");
    }
  }

  async listOrders(
    page: number,
    limit: number,
  ): Promise<{
    data: TenantOrder[];
    meta: { page: number; limit: number; total: number };
  }> {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new Error("Order pagination must use page >= 1 and limit 1-100");
    }
    const response = await this.request({
      method: "GET",
      path: "/orders",
      query: new URLSearchParams({ page: String(page), limit: String(limit) }),
    });
    const result = OrderPageSchema.parse(response.body);
    result.data.forEach((order) => this.assertTenant(order.tenantId));
    return result;
  }

  async getOrder(id: string): Promise<TenantOrder> {
    if (!/^ORD-[A-Fa-f0-9-]{36}$/.test(id)) {
      throw new Error("Order ID is invalid");
    }
    const response = await this.request({
      method: "GET",
      path: `/orders/${id}`,
    });
    const order = TenantOrderSchema.parse(
      typeof response.body === "object" &&
        response.body !== null &&
        "order" in response.body
        ? response.body.order
        : null,
    );
    this.assertTenant(order.tenantId);
    return order;
  }

  async updateOrderStatus(
    id: string,
    status: TenantOrder["status"],
    fulfillment?: TenantOrder["fulfillment"],
  ): Promise<TenantOrder> {
    if (!/^ORD-[A-Fa-f0-9-]{36}$/.test(id)) {
      throw new Error("Order ID is invalid");
    }
    const response = await this.request({
      method: "PATCH",
      path: `/orders/${id}`,
      body: { status, ...(fulfillment ? { fulfillment } : {}) },
    });
    const order = TenantOrderSchema.parse(
      typeof response.body === "object" &&
        response.body !== null &&
        "order" in response.body
        ? response.body.order
        : null,
    );
    this.assertTenant(order.tenantId);
    return fulfillment ? { ...order, fulfillment } : order;
  }

  private async request(request: RestHttpRequest): Promise<RestHttpResponse> {
    const response = await this.transport(this.config, this.apiKey, request);
    if (response.status < 200 || response.status >= 300) {
      throw new RestBackendError(
        response.status,
        response.status === 401 || response.status === 403
          ? "Tenant backend rejected the configured API key"
          : response.status === 404
            ? "Tenant order was not found"
            : response.status === 409
              ? "Tenant backend rejected the order operation"
              : response.status >= 500
                ? "Tenant backend encountered an error"
                : `Tenant backend returned HTTP ${response.status}`,
      );
    }
    return response;
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error("Order operation is outside the configured tenant scope");
    }
  }
}

export function createRestTenantOrderAdapter(
  config: TenantRestDataProviderConfig,
  apiKey: string,
  tenantId: string,
  transport?: RestTransport,
): RestTenantOrderAdapter {
  return new RestTenantOrderAdapter(config, apiKey, tenantId, transport);
}
