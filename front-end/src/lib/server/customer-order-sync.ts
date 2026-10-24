import "server-only";
import { RestBackendError } from "@/adapters/data/rest/catalog-adapter";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import type { PlatformStore } from "@/core/ports/platform-store";

export async function syncCustomerOrderToTenant(input: {
  store: PlatformStore;
  tenantId: string;
  hostId: string;
  order: CustomerOrder;
}): Promise<CustomerOrder> {
  const paymentConfirmed =
    input.order.paymentStatus === "paid" ||
    (input.order.paymentMethod === "cash_on_delivery" &&
      input.order.paymentStatus === "cod_due");
  if (!paymentConfirmed) {
    throw new Error(
      "Only paid or accepted cash-on-delivery orders can be sent to a Tenant backend",
    );
  }
  let status: CustomerOrder["backendSyncStatus"] = "synced";
  let errorMessage: string | undefined;
  try {
    const adapter = await createTenantOrderAdapter(
      input.tenantId,
      input.hostId,
    );
    await adapter.createOrder(input.order);
  } catch (error) {
    status = "failed";
    errorMessage = getSyncFailureMessage(error);
    console.error("Customer order sync failed", {
      tenantId: input.tenantId,
      orderId: input.order.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const updated = await input.store.updateCustomerOrderSync({
    tenantId: input.tenantId,
    customerId: input.order.customerId,
    orderId: input.order.id,
    status,
    error: errorMessage,
  });
  if (!updated) {
    throw new Error("Customer order disappeared while updating sync status");
  }
  return updated;
}

function getSyncFailureMessage(error: unknown): string {
  if (error instanceof RestBackendError) {
    if (error.status === 401 || error.status === 403) {
      return "The connected Tenant backend rejected its API key.";
    }
    if (error.status === 409) {
      return "The connected Tenant backend has a conflicting order with this ID.";
    }
    if (error.status === 422) {
      return "The connected Tenant backend rejected this order.";
    }
    if (error.status === 429) {
      return "The connected Tenant backend is rate limiting order delivery.";
    }
    return "The connected Tenant backend is unavailable.";
  }
  if (
    error instanceof Error &&
    error.message === "Tenant REST backend is not configured"
  ) {
    return "This store has no connected Tenant backend.";
  }
  return "The order could not be delivered to the connected Tenant backend.";
}
