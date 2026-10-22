import "server-only";
import { CustomerOrderSchema } from "@/core/domain/tenant-identities";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
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

const OrderResponseSchema = CustomerOrderSchema.omit({
  backendSyncStatus: true,
  backendSyncError: true,
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
    if (order.tenantId !== this.tenantId) {
      throw new Error("Order operation is outside the configured tenant scope");
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
        total: order.total,
        currency: order.currency,
        itemCount: order.itemCount,
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
}

export function createRestTenantOrderAdapter(
  config: TenantRestDataProviderConfig,
  apiKey: string,
  tenantId: string,
  transport?: RestTransport,
): RestTenantOrderAdapter {
  return new RestTenantOrderAdapter(config, apiKey, tenantId, transport);
}
