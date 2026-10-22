"use client";

import { useState } from "react";
import {
  CustomerOrderSchema,
  type CustomerOrder,
} from "@/core/domain/tenant-identities";

export function CustomerOrderSyncStatus({
  initialOrder,
}: {
  initialOrder: CustomerOrder;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  async function retrySync() {
    setRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(
        `/api/customer/orders/${encodeURIComponent(order.id)}/sync`,
        { method: "POST" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setRetryError(
          code === "rate_limited"
            ? "Too many retry attempts. Please wait a few minutes."
            : "Could not retry delivery. Please try again.",
        );
        return;
      }
      const result =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!result?.success) {
        setRetryError("The server returned an invalid order status.");
        return;
      }
      setOrder(result.data);
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={
        order.backendSyncStatus === "synced"
          ? "rounded-xl border border-emerald-200 bg-white p-4 text-sm text-emerald-900"
          : "rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
      }
      role="status"
    >
      {order.backendSyncStatus === "synced" ? (
        <p>Order delivered to the connected Tenant backend.</p>
      ) : order.backendSyncStatus === "not_configured" ? (
        <p>Tenant backend delivery was not requested for this order.</p>
      ) : (
        <>
          <p className="font-medium">
            {order.backendSyncStatus === "pending"
              ? "Order delivery is still pending."
              : "Order is saved, but delivery to the store backend did not complete."}
          </p>
          {order.backendSyncError && (
            <p className="mt-1">{order.backendSyncError}</p>
          )}
          {retryError && (
            <p className="mt-2 text-red-800" role="alert">
              {retryError}
            </p>
          )}
          <button
            className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-2 font-medium disabled:opacity-60"
            disabled={retrying}
            onClick={retrySync}
            type="button"
          >
            {retrying ? "Retrying…" : "Retry delivery"}
          </button>
        </>
      )}
    </div>
  );
}
