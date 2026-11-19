import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/core/domain/tenant-identities";
import type { PlatformStore } from "@/core/ports/platform-store";
import { cancelCustomerCodOrder } from "./cancel-customer-cod-order";
import { createTenantCatalogAdapter } from "@/adapters/data/rest/tenant-catalog";
import { createTenantOrderAdapter } from "@/adapters/data/rest/tenant-orders";

vi.mock("@/adapters/data/rest/tenant-catalog", () => ({
  createTenantCatalogAdapter: vi.fn(),
}));
vi.mock("@/adapters/data/rest/tenant-orders", () => ({
  createTenantOrderAdapter: vi.fn(),
}));

const tenantId = "550e8400-e29b-41d4-a716-446655440010";
const customerId = "550e8400-e29b-41d4-a716-446655440011";
const orderId = "ORD-550e8400-e29b-41d4-a716-446655440012";
const tenantScope = {
  kind: "tenant" as const,
  id: tenantId,
  hostId: "550e8400-e29b-41d4-a716-446655440000",
};

function codOrder(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: orderId,
    tenantId,
    customerId,
    status: "Confirmed",
    createdAt: new Date().toISOString(),
    items: [
      {
        productId: "product-1",
        title: "Cotton shirt",
        slug: "cotton-shirt",
        quantity: 1,
        unitPrice: 1500,
        currency: "INR",
        inventoryTracked: true,
      },
    ],
    subtotal: 1500,
    total: 1500,
    currency: "INR",
    itemCount: 1,
    paymentMethod: "cash_on_delivery",
    paymentStatus: "cod_due",
    paymentAttempt: 0,
    deliveryAddress: {
      fullName: "Test Customer",
      line1: "1 Market Road",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
      country: "IN",
      phone: "+919876543210",
    },
    discountCode: "SAVE10",
    backendSyncStatus: "synced",
    ...overrides,
  };
}

function createStore(initialOrder: CustomerOrder) {
  let order = initialOrder;
  const store = {
    getCustomerOrder: vi.fn(async () => order),
    cancelCustomerCodOrder: vi.fn(async () => {
      order = {
        ...order,
        status: "Cancelled",
        backendSyncStatus: "pending",
      };
      return order;
    }),
    updateCustomerOrderSync: vi.fn(async () => {
      order = { ...order, backendSyncStatus: "synced" };
      return order;
    }),
    cancelDiscountRedemption: vi.fn(),
    appendAuditEvent: vi.fn(),
  };
  return { store, getOrder: () => order };
}

describe("cancelCustomerCodOrder", () => {
  const updateOrderStatus = vi.fn();
  const restoreInventory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createTenantOrderAdapter).mockResolvedValue({
      updateOrderStatus,
    } as unknown as Awaited<ReturnType<typeof createTenantOrderAdapter>>);
    vi.mocked(createTenantCatalogAdapter).mockResolvedValue({
      restoreInventory,
    } as unknown as Awaited<ReturnType<typeof createTenantCatalogAdapter>>);
  });

  it("rejects paid Stripe orders before contacting tenant backends", async () => {
    const { store } = createStore(
      codOrder({ paymentMethod: "stripe", paymentStatus: "paid" }),
    );

    await expect(
      cancelCustomerCodOrder({
        store: store as unknown as PlatformStore,
        tenantId,
        hostId: tenantScope.hostId,
        customerId,
        orderId,
        actorId: customerId,
        scope: tenantScope,
        auditAction: "customer.order.cod_cancelled",
      }),
    ).resolves.toEqual({ error: "order_not_cancellable" });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
    expect(store.cancelCustomerCodOrder).not.toHaveBeenCalled();
  });

  it("requires the order to be synced before cancellation", async () => {
    const { store } = createStore(codOrder({ backendSyncStatus: "pending" }));

    await expect(
      cancelCustomerCodOrder({
        store: store as unknown as PlatformStore,
        tenantId,
        hostId: tenantScope.hostId,
        customerId,
        orderId,
        actorId: customerId,
        scope: tenantScope,
        auditAction: "customer.order.cod_cancelled",
      }),
    ).resolves.toEqual({ error: "order_sync_pending" });
    expect(createTenantOrderAdapter).not.toHaveBeenCalled();
    expect(store.cancelCustomerCodOrder).not.toHaveBeenCalled();
  });

  it("syncs cancellation and restores inventory and discounts idempotently", async () => {
    const { store, getOrder } = createStore(codOrder());
    const input = {
      store: store as unknown as PlatformStore,
      tenantId,
      hostId: tenantScope.hostId,
      customerId,
      orderId,
      actorId: customerId,
      scope: tenantScope,
      auditAction: "customer.order.cod_cancelled",
    };

    await expect(cancelCustomerCodOrder(input)).resolves.toMatchObject({
      order: { status: "Cancelled" },
      alreadyCancelled: false,
    });
    await expect(cancelCustomerCodOrder(input)).resolves.toMatchObject({
      order: { status: "Cancelled" },
      alreadyCancelled: true,
    });

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledWith(orderId, "Cancelled");
    expect(restoreInventory).toHaveBeenCalledTimes(1);
    expect(restoreInventory).toHaveBeenCalledWith(`${orderId}-cod`);
    expect(store.cancelDiscountRedemption).toHaveBeenCalledTimes(1);
    expect(store.cancelDiscountRedemption).toHaveBeenCalledWith(
      tenantId,
      orderId,
    );
    expect(store.cancelCustomerCodOrder).toHaveBeenCalledTimes(1);
    expect(store.updateCustomerOrderSync).toHaveBeenCalledWith({
      tenantId,
      customerId,
      orderId,
      status: "synced",
    });
    expect(store.appendAuditEvent).toHaveBeenCalledTimes(1);
    expect(getOrder().status).toBe("Cancelled");
  });

  it("allows retrying cleanup after the platform has claimed cancellation", async () => {
    const { store, getOrder } = createStore(codOrder());
    updateOrderStatus.mockRejectedValueOnce(new Error("backend unavailable"));
    const input = {
      store: store as unknown as PlatformStore,
      tenantId,
      hostId: tenantScope.hostId,
      customerId,
      orderId,
      actorId: customerId,
      scope: tenantScope,
      auditAction: "customer.order.cod_cancelled",
    };

    await expect(cancelCustomerCodOrder(input)).rejects.toThrow(
      "backend unavailable",
    );
    expect(getOrder()).toMatchObject({
      status: "Cancelled",
      backendSyncStatus: "pending",
    });

    await expect(cancelCustomerCodOrder(input)).resolves.toMatchObject({
      order: { status: "Cancelled", backendSyncStatus: "synced" },
      alreadyCancelled: true,
    });
    expect(store.cancelCustomerCodOrder).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(restoreInventory).toHaveBeenCalledTimes(1);
    expect(store.appendAuditEvent).toHaveBeenCalledTimes(1);
  });
});
