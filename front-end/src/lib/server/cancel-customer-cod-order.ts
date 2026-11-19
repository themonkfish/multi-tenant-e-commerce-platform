import { randomUUID } from "node:crypto";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import type { PlatformStore } from "@/core/ports/platform-store";
import type { AccessScope } from "@/core/tenancy/scope";

type TenantScope = Extract<AccessScope, { kind: "tenant" }>;

export type CancelCustomerCodOrderResult =
  | { order: CustomerOrder; alreadyCancelled: boolean }
  | {
      error: "order_not_found" | "order_not_cancellable" | "order_sync_pending";
    };

export async function cancelCustomerCodOrder(input: {
  store: PlatformStore;
  tenantId: string;
  hostId: string;
  customerId: string;
  orderId: string;
  actorId: string;
  scope: TenantScope;
  auditAction: string;
}): Promise<CancelCustomerCodOrderResult> {
  const order = await input.store.getCustomerOrder(
    input.tenantId,
    input.customerId,
    input.orderId,
  );
  if (!order) return { error: "order_not_found" };

  const alreadyCancelled = order.status === "Cancelled";
  const shouldAuditCancellation =
    !alreadyCancelled || order.backendSyncStatus !== "synced";
  if (
    order.paymentMethod !== "cash_on_delivery" ||
    order.paymentStatus !== "cod_due" ||
    (!alreadyCancelled &&
      (order.status !== "Confirmed" || order.fulfillment !== undefined))
  ) {
    return { error: "order_not_cancellable" };
  }
  if (alreadyCancelled && order.backendSyncStatus === "synced") {
    return { order, alreadyCancelled: true };
  }
  if (!alreadyCancelled && order.backendSyncStatus !== "synced") {
    return { error: "order_sync_pending" };
  }

  const cancelledOrder = alreadyCancelled
    ? order
    : await input.store.cancelCustomerCodOrder({
        tenantId: input.tenantId,
        customerId: input.customerId,
        orderId: input.orderId,
      });
  if (!cancelledOrder) return { error: "order_not_cancellable" };

  const tenantOrders = await createTenantOrderAdapter(
    input.tenantId,
    input.hostId,
  );
  await tenantOrders.updateOrderStatus(order.id, "Cancelled");

  if (order.items.some((item) => item.inventoryTracked)) {
    const catalog = await createTenantCatalogAdapter(
      input.tenantId,
      input.hostId,
    );
    await catalog.restoreInventory(`${order.id}-cod`);
  }
  if (order.discountCode) {
    await input.store.cancelDiscountRedemption(input.tenantId, order.id);
  }

  const syncedOrder = await input.store.updateCustomerOrderSync({
    tenantId: input.tenantId,
    customerId: input.customerId,
    orderId: input.orderId,
    status: "synced",
  });
  if (!syncedOrder) throw new Error("Cancelled customer order was not found");

  if (shouldAuditCancellation) {
    await input.store.appendAuditEvent({
      id: randomUUID(),
      actorId: input.actorId,
      scope: input.scope,
      action: input.auditAction,
      resourceType: "customer_order",
      resourceId: order.id,
      createdAt: new Date().toISOString(),
    });
  }

  return { order: syncedOrder, alreadyCancelled };
}
