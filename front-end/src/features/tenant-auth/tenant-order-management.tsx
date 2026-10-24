"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CustomerOrderSchema,
  TenantOrderSchema,
  type CustomerOrder,
  type TenantOrder,
} from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";
import { z } from "zod";

const OrderPageSchema = z.object({
  data: z.array(TenantOrderSchema),
  meta: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});

function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return "Could not load tenant orders.";
  }
  switch (body.error) {
    case "connection_not_configured":
      return "Connect the Tenant REST backend in store setup to manage orders.";
    case "tenant_backend_error":
    case "tenant_backend_unavailable":
      return "The Tenant backend is unavailable. Try again later.";
    case "rate_limited":
      return "Too many requests. Please wait and try again.";
    default:
      return "Could not load tenant orders.";
  }
}

export function TenantOrderManagement({
  canManage,
  locale,
}: {
  canManage: boolean;
  locale: string;
}) {
  const [orders, setOrders] = useState<TenantOrder[]>([]);
  const [cashOrders, setCashOrders] = useState<CustomerOrder[]>([]);
  const [cashPage, setCashPage] = useState(1);
  const [cashTotal, setCashTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<TenantOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cashError, setCashError] = useState("");

  const loadOrders = useCallback(
    async (pageNumber: number) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/tenant/orders?page=${pageNumber}&limit=${limit}`,
          { cache: "no-store" },
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          setError(errorMessage(body));
          return;
        }
        const parsed = OrderPageSchema.safeParse(body);
        if (!parsed.success) {
          setError("The Tenant backend returned an invalid order list.");
          return;
        }
        setOrders(parsed.data.data);
        setTotal(parsed.data.meta.total);
        setPage(parsed.data.meta.page);
        setSelected((current) =>
          current
            ? (parsed.data.data.find((order) => order.id === current.id) ??
              null)
            : null,
        );
      } catch {
        setError("Could not reach the Tenant backend.");
      } finally {
        setLoading(false);
      }
    },
    [limit],
  );

  const loadCashOrders = useCallback(async (pageNumber: number) => {
    setCashError("");
    try {
      const response = await fetch(
        `/api/tenant/cash-on-delivery?page=${pageNumber}&limit=20`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setCashError("Could not load pending cash-on-delivery orders.");
        return;
      }
      const parsed = z
        .object({
          data: z.array(CustomerOrderSchema),
          meta: z.object({
            page: z.number().int().positive(),
            limit: z.number().int().positive(),
            total: z.number().int().nonnegative(),
          }),
        })
        .safeParse(body);
      if (!parsed.success) {
        setCashError("The platform returned an invalid cash-on-delivery list.");
        return;
      }
      setCashOrders(parsed.data.data);
      setCashPage(parsed.data.meta.page);
      setCashTotal(parsed.data.meta.total);
    } catch {
      setCashError("Could not reach pending cash-on-delivery orders.");
    }
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (current) {
        void loadOrders(page);
        void loadCashOrders(cashPage);
      }
    });
    return () => {
      current = false;
    };
  }, [cashPage, loadCashOrders, loadOrders, page]);

  async function updateStatus(order: TenantOrder) {
    const nextStatus = order.status === "Confirmed" ? "Processing" : "Shipped";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status: nextStatus }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(errorMessage(body));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? TenantOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success) {
        setError("The Tenant backend returned an invalid order.");
        return;
      }
      setSelected(parsed.data);
      setNotice(`Order status updated to ${parsed.data.status}.`);
      await loadOrders(page);
    } catch {
      setError("Could not reach the Tenant backend.");
    } finally {
      setBusy(false);
    }
  }

  async function markCashCollected(order: CustomerOrder) {
    setBusy(true);
    setCashError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/cash-on-delivery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setCashError(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            body.error === "cod_order_not_due"
            ? "This order has already been collected or is no longer due."
            : "Cash collection could not be confirmed. Try again.",
        );
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success || parsed.data.paymentStatus !== "paid") {
        setCashError("The platform returned an invalid collection result.");
        return;
      }
      setCashOrders((current) =>
        current.filter((candidate) => candidate.id !== parsed.data.id),
      );
      setCashTotal((current) => Math.max(0, current - 1));
      if (cashOrders.length === 1 && cashPage > 1) {
        setCashPage((current) => current - 1);
      } else {
        await loadCashOrders(cashPage);
      }
      setNotice(`Cash collection confirmed for ${parsed.data.id}.`);
    } catch {
      setCashError("Could not reach the platform to confirm collection.");
    } finally {
      setBusy(false);
    }
  }

  async function viewOrder(orderId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/tenant/orders/${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(errorMessage(body));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? TenantOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success) {
        setError("The Tenant backend returned an invalid order.");
        return;
      }
      setSelected(parsed.data);
    } catch {
      setError("Could not reach the Tenant backend.");
    } finally {
      setBusy(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-green-700" role="status">
          {notice}
        </p>
      )}
      {cashError && (
        <p className="text-sm text-red-700" role="alert">
          {cashError}
        </p>
      )}
      <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div>
          <h2 className="text-lg font-semibold text-amber-950">
            Cash on delivery
          </h2>
          <p className="text-sm text-amber-900">
            Orders remain unpaid until a store operator receives the cash.
          </p>
        </div>
        {cashOrders.length === 0 ? (
          <p className="text-sm text-slate-600">
            No pending cash-on-delivery orders.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {cashOrders.map((order) => (
                <article
                  className="rounded-md border border-amber-200 bg-white p-4"
                  key={order.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{order.id}</p>
                      <p className="text-sm text-slate-600">
                        {order.itemCount} items ·{" "}
                        {formatCurrencyAmount(
                          order.total,
                          order.currency,
                          locale,
                        )}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        className="rounded-md bg-amber-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        disabled={busy}
                        onClick={() => void markCashCollected(order)}
                        type="button"
                      >
                        {busy ? "Confirming…" : "Mark cash collected"}
                      </button>
                    )}
                  </div>
                  {order.deliveryAddress && (
                    <address className="mt-3 not-italic text-sm text-slate-700">
                      <span className="font-medium">
                        {order.deliveryAddress.fullName}
                      </span>
                      <br />
                      {order.deliveryAddress.line1}
                      {order.deliveryAddress.line2
                        ? `, ${order.deliveryAddress.line2}`
                        : ""}
                      <br />
                      {order.deliveryAddress.city},{" "}
                      {order.deliveryAddress.state}{" "}
                      {order.deliveryAddress.postalCode}, India
                      <br />
                      {order.deliveryAddress.phone}
                    </address>
                  )}
                </article>
              ))}
            </div>
            {cashTotal > 20 && (
              <div className="flex items-center justify-between text-sm">
                <span>
                  Page {cashPage} · {cashTotal} pending
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-50"
                    disabled={cashPage <= 1 || busy}
                    onClick={() => setCashPage((current) => current - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-50"
                    disabled={cashPage * 20 >= cashTotal || busy}
                    onClick={() => setCashPage((current) => current + 1)}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {loading ? (
        <p className="text-sm text-slate-600">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-slate-600">
          No orders have been delivered to this Tenant backend.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Placed</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-4 py-3 font-medium">{order.id}</td>
                    <td className="px-4 py-3">
                      {dateFormatter.format(new Date(order.createdAt))}
                    </td>
                    <td className="px-4 py-3">{order.itemCount}</td>
                    <td className="px-4 py-3">
                      {formatCurrencyAmount(
                        order.total,
                        order.currency,
                        locale,
                      )}
                    </td>
                    <td className="px-4 py-3">{order.status}</td>
                    <td className="px-4 py-3">
                      <button
                        className="font-medium text-indigo-700 underline"
                        disabled={busy}
                        onClick={() => void viewOrder(order.id)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)}{" "}
              of {total}
            </span>
            <div className="flex gap-2">
              <button
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page * limit >= total || loading}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">Order details</p>
              <h2 className="text-lg font-semibold">{selected.id}</h2>
            </div>
            <button
              className="text-sm text-slate-600 underline"
              onClick={() => setSelected(null)}
              type="button"
            >
              Close
            </button>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Customer ID</dt>
              <dd className="break-all font-medium">{selected.customerId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Placed</dt>
              <dd className="font-medium">
                {dateFormatter.format(new Date(selected.createdAt))}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium">{selected.status}</dd>
            </div>
          </dl>
          <ul className="divide-y divide-slate-100 rounded border">
            {selected.items.map((item) => (
              <li
                className="flex justify-between gap-4 p-3 text-sm"
                key={item.productId}
              >
                <span>
                  {item.title} × {item.quantity}
                </span>
                <span>
                  {formatCurrencyAmount(
                    item.unitPrice * item.quantity,
                    item.currency,
                    locale,
                  )}
                </span>
              </li>
            ))}
            <li className="flex justify-between p-3 font-semibold">
              <span>Total</span>
              <span>
                {formatCurrencyAmount(
                  selected.total,
                  selected.currency,
                  locale,
                )}
              </span>
            </li>
          </ul>
          {canManage && selected.status !== "Shipped" && (
            <button
              className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => void updateStatus(selected)}
              type="button"
            >
              {busy
                ? "Updating…"
                : selected.status === "Confirmed"
                  ? "Mark as processing"
                  : "Mark as shipped"}
            </button>
          )}
          <p className="text-xs text-slate-500">
            Status updates are operational labels only; no payment or shipping
            action is triggered.
          </p>
        </section>
      )}
    </div>
  );
}
