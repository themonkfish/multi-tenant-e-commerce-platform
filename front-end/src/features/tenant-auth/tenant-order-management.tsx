"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

function errorMessage(body: unknown, t: (key: string) => string): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return t("loadFailed");
  }
  switch (body.error) {
    case "invalid_input":
      return t("invalidTracking");
    case "connection_not_configured":
      return t("connectionRequired");
    case "order_not_cancellable":
      return t("notCancellable");
    case "order_sync_pending":
      return t("syncPending");
    case "tenant_backend_error":
    case "tenant_backend_unavailable":
      return t("backendUnavailable");
    case "rate_limited":
      return t("tooManyRequests");
    case "shiprocket_credentials_required":
      return t("shiprocketCredentialsRequired");
    case "shipment_already_created":
      return t("shipmentAlreadyCreated");
    case "delivery_address_required":
      return t("deliveryAddressRequired");
    case "shiprocket_auth_failed":
    case "shiprocket_create_failed":
    case "shiprocket_awb_failed":
    case "shiprocket_awb_missing":
    case "tenant_order_sync_failed":
      return t("shiprocketFailed");
    default:
      return t("loadFailed");
  }
}

export function TenantOrderManagement({
  canManage,
  locale,
}: {
  canManage: boolean;
  locale: string;
}) {
  const t = useTranslations("TenantOrders");
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
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [weightKg, setWeightKg] = useState("0.5");
  const [lengthCm, setLengthCm] = useState("20");
  const [breadthCm, setBreadthCm] = useState("15");
  const [heightCm, setHeightCm] = useState("10");

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
          setError(errorMessage(body, t));
          return;
        }
        const parsed = OrderPageSchema.safeParse(body);
        if (!parsed.success) {
          setError(t("invalidOrderList"));
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
        setError(t("backendReachFailed"));
      } finally {
        setLoading(false);
      }
    },
    [limit, t],
  );

  const loadCashOrders = useCallback(
    async (pageNumber: number) => {
      setCashError("");
      try {
        const response = await fetch(
          `/api/tenant/cash-on-delivery?page=${pageNumber}&limit=20`,
          { cache: "no-store" },
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          setCashError(t("cashLoadFailed"));
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
          setCashError(t("invalidCashList"));
          return;
        }
        setCashOrders(parsed.data.data);
        setCashPage(parsed.data.meta.page);
        setCashTotal(parsed.data.meta.total);
      } catch {
        setCashError(t("cashReachFailed"));
      }
    },
    [t],
  );

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

  async function updateStatus(
    order: TenantOrder,
    fulfillment?: NonNullable<TenantOrder["fulfillment"]>,
    requestedStatus?: Extract<
      TenantOrder["status"],
      "Processing" | "Shipped" | "Delivered"
    >,
  ) {
    const nextStatus =
      requestedStatus ??
      (order.status === "Confirmed" ? "Processing" : "Shipped");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          status: nextStatus,
          ...(fulfillment ? { fulfillment } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(errorMessage(body, t));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? TenantOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success) {
        setError(t("invalidOrder"));
        return;
      }
      setSelected(parsed.data);
      setCarrier(parsed.data.fulfillment?.carrier ?? "");
      setTrackingNumber(parsed.data.fulfillment?.trackingNumber ?? "");
      setTrackingUrl(parsed.data.fulfillment?.trackingUrl ?? "");
      setCarrier(parsed.data.fulfillment?.carrier ?? "");
      setTrackingNumber(parsed.data.fulfillment?.trackingNumber ?? "");
      setTrackingUrl(parsed.data.fulfillment?.trackingUrl ?? "");
      setNotice(
        nextStatus === "Delivered"
          ? t("orderDelivered")
          : parsed.data.fulfillment
            ? t("orderShipped")
            : t("statusUpdated", { status: parsed.data.status }),
      );
      await loadOrders(page);
    } catch {
      setError(t("backendReachFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createShiprocketShipment(order: TenantOrder) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/shipments/shiprocket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          package: {
            weightKg: Number(weightKg),
            lengthCm: Number(lengthCm),
            breadthCm: Number(breadthCm),
            heightCm: Number(heightCm),
          },
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(errorMessage(body, t));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success) {
        setError(t("invalidOrder"));
        return;
      }
      setSelected(null);
      setNotice(t("orderShipped"));
      await loadOrders(page);
      await loadCashOrders(cashPage);
    } catch {
      setError(t("backendReachFailed"));
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
            ? t("codAlreadyCollected")
            : t("collectionFailed"),
        );
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success || parsed.data.paymentStatus !== "paid") {
        setCashError(t("invalidCollectionResult"));
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
      setNotice(t("collectionConfirmed", { id: parsed.data.id }));
    } catch {
      setCashError(t("collectionReachFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCashOrder(order: CustomerOrder) {
    if (!window.confirm(t("cancelCodConfirm"))) {
      return;
    }
    setBusy(true);
    setCashError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status: "Cancelled" }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setCashError(errorMessage(body, t));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success || parsed.data.status !== "Cancelled") {
        setCashError(t("invalidCancellationResult"));
        return;
      }
      setCashOrders((current) =>
        current.filter((candidate) => candidate.id !== parsed.data.id),
      );
      setCashTotal((current) => Math.max(0, current - 1));
      setNotice(t("orderCancelled", { id: parsed.data.id }));
      await Promise.all([loadOrders(page), loadCashOrders(cashPage)]);
    } catch {
      setCashError(t("cancellationReachFailed"));
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
        setError(errorMessage(body, t));
        return;
      }
      const parsed =
        typeof body === "object" && body !== null && "order" in body
          ? TenantOrderSchema.safeParse(body.order)
          : null;
      if (!parsed?.success) {
        setError(t("invalidOrder"));
        return;
      }
      setSelected(parsed.data);
    } catch {
      setError(t("backendReachFailed"));
    } finally {
      setBusy(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const canManageShipment =
    canManage &&
    (selected?.status === "Processing" || selected?.status === "Shipped");

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
            {t("cashOnDelivery")}
          </h2>
          <p className="text-sm text-amber-900">{t("codDescription")}</p>
        </div>
        {cashOrders.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noPendingCod")}</p>
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
                        {t("itemsCount", { count: order.itemCount })} ·{" "}
                        {formatCurrencyAmount(
                          order.total,
                          order.currency,
                          locale,
                        )}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md bg-amber-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          disabled={busy}
                          onClick={() => void markCashCollected(order)}
                          type="button"
                        >
                          {busy ? t("confirming") : t("markCashCollected")}
                        </button>
                        <button
                          className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                          disabled={busy}
                          onClick={() => void cancelCashOrder(order)}
                          type="button"
                        >
                          {t("cancelOrder")}
                        </button>
                      </div>
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
                      {order.deliveryAddress.postalCode} , {t("india")}
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
                  {t("cashPage", { page: cashPage, total: cashTotal })}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-50"
                    disabled={cashPage <= 1 || busy}
                    onClick={() => setCashPage((current) => current - 1)}
                    type="button"
                  >
                    {t("previous")}
                  </button>
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-50"
                    disabled={cashPage * 20 >= cashTotal || busy}
                    onClick={() => setCashPage((current) => current + 1)}
                    type="button"
                  >
                    {t("next")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {loading ? (
        <p className="text-sm text-slate-600">{t("loadingOrders")}</p>
      ) : orders.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-slate-600">
          {t("noOrders")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">{t("orderColumn")}</th>
                  <th className="px-4 py-3">{t("placedColumn")}</th>
                  <th className="px-4 py-3">{t("itemsColumn")}</th>
                  <th className="px-4 py-3">{t("totalColumn")}</th>
                  <th className="px-4 py-3">{t("statusColumn")}</th>
                  <th className="px-4 py-3">{t("detailsColumn")}</th>
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
                    <td className="px-4 py-3">{t(order.status)}</td>
                    <td className="px-4 py-3">
                      <button
                        className="font-medium text-indigo-700 underline"
                        disabled={busy}
                        onClick={() => void viewOrder(order.id)}
                        type="button"
                      >
                        {t("view")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>
              {t("showing", {
                from: (page - 1) * limit + 1,
                to: Math.min(page * limit, total),
                total,
              })}
            </span>
            <div className="flex gap-2">
              <button
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
                type="button"
              >
                {t("previous")}
              </button>
              <button
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page * limit >= total || loading}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                {t("next")}
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">{t("orderDetails")}</p>
              <h2 className="text-lg font-semibold">{selected.id}</h2>
            </div>
            <button
              className="text-sm text-slate-600 underline"
              onClick={() => setSelected(null)}
              type="button"
            >
              {t("close")}
            </button>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">{t("customerId")}</dt>
              <dd className="break-all font-medium">{selected.customerId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("placed")}</dt>
              <dd className="font-medium">
                {dateFormatter.format(new Date(selected.createdAt))}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("status")}</dt>
              <dd className="font-medium">{t(selected.status)}</dd>
            </div>
          </dl>
          {selected.fulfillment && (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 p-4 text-sm">
              <h3 className="font-semibold text-slate-900">
                {t("shipmentTracking")}
              </h3>
              <p className="mt-1 text-slate-700">
                {selected.fulfillment.carrier
                  ? `${selected.fulfillment.carrier} · `
                  : ""}
                {selected.fulfillment.trackingNumber}
              </p>
              {selected.fulfillment.trackingUrl && (
                <a
                  className="mt-2 inline-block font-medium text-indigo-700 underline"
                  href={selected.fulfillment.trackingUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("trackShipment")}
                </a>
              )}
            </div>
          )}
          <ul className="divide-y divide-slate-100 rounded border">
            {selected.items.map((item) => (
              <li
                className="flex justify-between gap-4 p-3 text-sm"
                key={`${item.productId}:${JSON.stringify(item.variantSelections ?? {})}`}
              >
                <span>
                  {item.title} × {item.quantity}
                  {item.variantSelections && (
                    <span className="block text-xs text-slate-500">
                      {Object.entries(item.variantSelections)
                        .map(([name, value]) => `${name}: ${value}`)
                        .join(" · ")}
                    </span>
                  )}
                  {item.sku && (
                    <span className="block text-xs text-slate-500">
                      SKU: {item.sku}
                    </span>
                  )}
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
            <li className="flex justify-between p-3 text-sm text-slate-600">
              <span>{t("subtotal")}</span>
              <span>
                {formatCurrencyAmount(
                  selected.subtotal ??
                    selected.items.reduce(
                      (sum, item) => sum + item.unitPrice * item.quantity,
                      0,
                    ),
                  selected.currency,
                  locale,
                )}
              </span>
            </li>
            {(selected.discountAmount ?? 0) > 0 && (
              <li className="flex justify-between p-3 text-sm text-slate-600">
                <span>
                  {t("discount")}
                  {selected.discountCode ? ` (${selected.discountCode})` : ""}
                </span>
                <span>
                  −
                  {formatCurrencyAmount(
                    selected.discountAmount ?? 0,
                    selected.currency,
                    locale,
                  )}
                </span>
              </li>
            )}
            {(selected.taxAmount ?? 0) > 0 && (
              <li className="flex justify-between p-3 text-sm text-slate-600">
                <span>{t("tax")}</span>
                <span>
                  {formatCurrencyAmount(
                    selected.taxAmount ?? 0,
                    selected.currency,
                    locale,
                  )}
                </span>
              </li>
            )}
            <li className="flex justify-between p-3 text-sm text-slate-600">
              <span>{t("shipping")}</span>
              <span>
                {formatCurrencyAmount(
                  selected.shippingAmount ?? 0,
                  selected.currency,
                  locale,
                )}
              </span>
            </li>
            <li className="flex justify-between p-3 font-semibold">
              <span>{t("total")}</span>
              <span>
                {formatCurrencyAmount(
                  selected.total,
                  selected.currency,
                  locale,
                )}
              </span>
            </li>
          </ul>
          {canManage && selected.status === "Confirmed" && (
            <button
              className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => void updateStatus(selected)}
              type="button"
            >
              {busy ? t("updating") : t("markProcessing")}
            </button>
          )}
          {canManageShipment && (
            <div className="space-y-3 rounded-md border border-slate-200 p-4">
              <h3 className="font-medium text-slate-900">
                {t("shipmentDetails")}
              </h3>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["weightKg", weightKg, setWeightKg],
                  ["lengthCm", lengthCm, setLengthCm],
                  ["breadthCm", breadthCm, setBreadthCm],
                  ["heightCm", heightCm, setHeightCm],
                ].map(([key, value, setValue]) => (
                  <label className="space-y-1 text-sm" key={String(key)}>
                    <span className="block font-medium">{t(String(key))}</span>
                    <input
                      className="w-full rounded border px-3 py-2"
                      min="0.01"
                      step="0.01"
                      type="number"
                      value={String(value)}
                      onChange={(event) =>
                        (setValue as (value: string) => void)(
                          event.target.value,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {!selected.fulfillment && (
                <button
                  className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-800 disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void createShiprocketShipment(selected)}
                  type="button"
                >
                  {busy ? t("updating") : t("createShiprocketShipment")}
                </button>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("carrier")}</span>
                  <input
                    className="w-full rounded border px-3 py-2"
                    maxLength={80}
                    onChange={(event) => setCarrier(event.target.value)}
                    value={carrier}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">
                    {t("trackingNumber")}
                  </span>
                  <input
                    className="w-full rounded border px-3 py-2"
                    maxLength={120}
                    onChange={(event) => setTrackingNumber(event.target.value)}
                    value={trackingNumber}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("trackingUrl")}</span>
                  <input
                    className="w-full rounded border px-3 py-2"
                    maxLength={2048}
                    onChange={(event) => setTrackingUrl(event.target.value)}
                    placeholder="https://…"
                    type="url"
                    value={trackingUrl}
                  />
                </label>
              </div>
              <button
                className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={busy}
                onClick={() => {
                  const hasTrackingDetails =
                    carrier.trim() ||
                    trackingNumber.trim() ||
                    trackingUrl.trim();
                  if (hasTrackingDetails && !trackingNumber.trim()) {
                    setError(t("trackingNumberRequired"));
                    return;
                  }
                  void updateStatus(
                    selected,
                    trackingNumber.trim()
                      ? {
                          trackingNumber: trackingNumber.trim(),
                          ...(carrier.trim()
                            ? { carrier: carrier.trim() }
                            : {}),
                          ...(trackingUrl.trim()
                            ? { trackingUrl: trackingUrl.trim() }
                            : {}),
                        }
                      : undefined,
                  );
                }}
                type="button"
              >
                {busy
                  ? t("updating")
                  : selected.status === "Shipped"
                    ? t("saveTracking")
                    : t("markShipped")}
              </button>
              {selected.status === "Shipped" && (
                <button
                  className="ml-2 rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-800 disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void updateStatus(selected, undefined, "Delivered")
                  }
                  type="button"
                >
                  {busy ? t("updating") : t("markDelivered")}
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-slate-500">{t("statusUpdateNotice")}</p>
        </section>
      )}
    </div>
  );
}
