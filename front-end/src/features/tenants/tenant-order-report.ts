import type { CustomerOrder } from "@/core/domain/tenant-identities";

export type TenantOrderReport = {
  orderCount: number;
  grossSalesMinor: number;
  averageOrderMinor: number;
  unitsSold: number;
  topProducts: Array<{ productId: string; title: string; units: number; revenueMinor: number }>;
  paidCount: number;
  codDueCount: number;
  refundedCount: number;
  cancelledCount: number;
  shippedCount: number;
  deliveredCount: number;
};

export function summarizeTenantOrders(
  orders: CustomerOrder[],
): TenantOrderReport {
  const activeOrders = orders.filter((order) => order.status !== "Cancelled");
  const productTotals = new Map<
    string,
    { productId: string; title: string; units: number; revenueMinor: number }
  >();
  for (const order of activeOrders) {
    for (const item of order.items) {
      const current = productTotals.get(item.productId) ?? {
        productId: item.productId,
        title: item.title,
        units: 0,
        revenueMinor: 0,
      };
      current.units += item.quantity;
      current.revenueMinor += item.unitPrice * item.quantity;
      productTotals.set(item.productId, current);
    }
  }
  const grossSalesMinor = activeOrders.reduce(
    (sum, order) => sum + order.total,
    0,
  );
  return {
    orderCount: orders.length,
    grossSalesMinor,
    averageOrderMinor:
      activeOrders.length > 0
        ? Math.round(grossSalesMinor / activeOrders.length)
        : 0,
    unitsSold: [...productTotals.values()].reduce(
      (sum, product) => sum + product.units,
      0,
    ),
    topProducts: [...productTotals.values()]
      .sort(
        (left, right) =>
          right.revenueMinor - left.revenueMinor || right.units - left.units,
      )
      .slice(0, 5),
    paidCount: orders.filter((order) => order.paymentStatus === "paid").length,
    codDueCount: orders.filter((order) => order.paymentStatus === "cod_due")
      .length,
    refundedCount: orders.filter((order) => order.paymentStatus === "refunded")
      .length,
    cancelledCount: orders.filter((order) => order.status === "Cancelled")
      .length,
    shippedCount: orders.filter((order) => order.status === "Shipped").length,
    deliveredCount: orders.filter((order) => order.status === "Delivered")
      .length,
  };
}
