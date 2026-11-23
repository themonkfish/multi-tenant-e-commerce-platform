import type { CustomerOrder } from "@/core/domain/tenant-identities";

export type TenantOrderReport = {
  orderCount: number;
  grossSalesMinor: number;
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
  return {
    orderCount: orders.length,
    grossSalesMinor: orders.reduce(
      (sum, order) => (order.status === "Cancelled" ? sum : sum + order.total),
      0,
    ),
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
