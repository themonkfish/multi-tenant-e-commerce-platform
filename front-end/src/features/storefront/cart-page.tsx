"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import {
  CustomerDeliveryAddressSchema,
  CustomerOrderSchema,
  type CustomerDeliveryAddress,
} from "@/core/domain/tenant-identities";
import { formatCurrencyAmount } from "@/core/domain/money";
import { calculateTaxAmount } from "@/core/domain/tax";
import { getCartItemKey, useCartStore } from "@/features/storefront/cart-store";

export function StorefrontCartPage({
  locale,
  signedIn,
  paymentFailed,
  shipping,
  taxRateBasisPoints,
  currency,
}: {
  locale: string;
  signedIn: boolean;
  paymentFailed: boolean;
  shipping: { flatRate: number; freeShippingThreshold?: number };
  taxRateBasisPoints: number;
  currency: string;
}) {
  const router = useRouter();
  const t = useTranslations("CustomerCart");
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clear = useCartStore((state) => state.clear);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [checkingOut, setCheckingOut] = useState(false);
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    amount: number;
    signature: string;
  } | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "stripe" | "cash_on_delivery"
  >("stripe");
  const [deliveryAddress, setDeliveryAddress] =
    useState<CustomerDeliveryAddress>({
      fullName: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "IN",
      phone: "+91",
    });
  const supportsCashOnDelivery =
    items.length > 0 && items.every((item) => item.currency === "INR");

  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.quantity * item.price, 0),
    [items],
  );
  const cartSignature = JSON.stringify(
    items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      price: item.price,
      variantSelections: item.variantSelections ?? {},
    })),
  );
  const activeDiscount =
    appliedDiscount?.signature === cartSignature &&
    appliedDiscount.code === discountCode.trim().toUpperCase()
      ? appliedDiscount
      : null;
  const discountAmount = activeDiscount?.amount ?? 0;
  const taxAmount = calculateTaxAmount(
    subtotal - discountAmount,
    taxRateBasisPoints,
  );
  const estimatedShipping =
    shipping.freeShippingThreshold !== undefined &&
    subtotal >= shipping.freeShippingThreshold
      ? 0
      : shipping.flatRate;
  const shippingCurrencyMismatch =
    items.some((item) => item.currency !== currency) &&
    (shipping.flatRate > 0 || shipping.freeShippingThreshold !== undefined);

  async function applyDiscount() {
    setApplyingDiscount(true);
    setDiscountError("");
    setAppliedDiscount(null);
    try {
      const response = await fetch("/api/customer/discounts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: discountCode,
          items: items.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            ...(item.variantSelections
              ? { variantSelections: item.variantSelections }
              : {}),
          })),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : "";
        setDiscountError(
          code === "discount_expired"
            ? t("errors.discountExpired")
            : code === "discount_minimum_not_met"
              ? t("errors.discountMinimumNotMet")
              : code === "discount_limit_reached"
                ? t("errors.discountLimitReached")
                : code === "rate_limited"
                  ? t("errors.discountRateLimited")
                  : t("errors.discountInvalid"),
        );
        return;
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("code" in body) ||
        typeof body.code !== "string" ||
        !("discountAmount" in body) ||
        typeof body.discountAmount !== "number"
      ) {
        setDiscountError(t("errors.discountInvalidResponse"));
        return;
      }
      const normalizedCode = body.code;
      setDiscountCode(normalizedCode);
      setAppliedDiscount({
        code: normalizedCode,
        amount: body.discountAmount,
        signature: cartSignature,
      });
      idempotencyKey.current = crypto.randomUUID();
    } catch {
      setDiscountError(t("errors.discountUnavailable"));
    } finally {
      setApplyingDiscount(false);
    }
  }

  async function onCheckout() {
    if (!signedIn) {
      router.push(
        `/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`,
      );
      return;
    }

    if (!CustomerDeliveryAddressSchema.safeParse(deliveryAddress).success) {
      setError(t("errors.invalidDeliveryAddress"));
      return;
    }

    setCheckingOut(true);
    setError("");
    try {
      const response = await fetch("/api/customer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          paymentMethod,
          ...(activeDiscount ? { discountCode: activeDiscount.code } : {}),
          deliveryAddress,
          items: items.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            expectedUnitPrice: item.price,
            ...(item.variantSelections
              ? { variantSelections: item.variantSelections }
              : {}),
          })),
        }),
      });
      const body: unknown = await response.json();
      if (response.status === 202) {
        setError(t("errors.paymentProcessing"));
        return;
      }
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        if (code === "customer_sign_in_required") {
          router.push(
            `/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`,
          );
          return;
        }
        setError(
          code === "discount_limit_reached"
            ? t("errors.discountLimitDuringCheckout")
            : code === "discount_minimum_not_met"
              ? t("errors.discountMinimumDuringCheckout")
              : code === "discount_expired"
                ? t("errors.discountExpiredDuringCheckout")
                : code === "discount_currency_unsupported"
                  ? t("errors.discountCurrencyUnsupported", { currency })
                  : code === "discount_code_invalid"
                    ? t("errors.discountCodeNoLongerValid")
                    : code === "cart_changed"
                      ? t("errors.cartChanged")
                      : code === "insufficient_stock"
                        ? t("errors.insufficientStock")
                        : code === "connection_not_configured"
                          ? t("errors.productBackendNotConfigured")
                          : code === "tenant_backend_unavailable"
                            ? t("errors.productBackendUnavailable")
                            : code === "payment_not_configured"
                              ? t("errors.paymentNotConfigured")
                              : code === "payment_provider_unavailable"
                                ? t("errors.paymentUnavailable")
                                : code === "payment_method_disabled"
                                  ? t("errors.paymentMethodDisabled")
                                  : code ===
                                      "cash_on_delivery_currency_unsupported"
                                    ? t(
                                        "errors.cashOnDeliveryCurrencyUnsupported",
                                      )
                                    : code === "invalid_cart"
                                      ? t("errors.invalidDeliveryAddress")
                                      : code === "shipping_currency_unsupported"
                                        ? t(
                                            "errors.shippingCurrencyUnsupported",
                                            {
                                              currency,
                                            },
                                          )
                                        : code === "free_checkout_not_supported"
                                          ? t(
                                              "errors.freeCardCheckoutUnsupported",
                                            )
                                          : code === "idempotency_key_conflict"
                                            ? t("errors.idempotencyConflict")
                                            : code === "rate_limited"
                                              ? t("errors.checkoutRateLimited")
                                              : t(
                                                  "errors.orderPlacementFailed",
                                                ),
        );
        return;
      }
      const order =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!order?.success) {
        setError(t("errors.invalidCheckoutResponse"));
        return;
      }
      if (
        order.data.paymentStatus === "paid" ||
        order.data.paymentStatus === "cod_due"
      ) {
        clear();
        router.push(
          `/${locale}/checkout/success?orderId=${encodeURIComponent(order.data.id)}`,
        );
        return;
      }
      const checkoutUrl =
        typeof body === "object" && body !== null && "checkoutUrl" in body
          ? body.checkoutUrl
          : undefined;
      if (typeof checkoutUrl !== "string") {
        setError(t("errors.paymentLinkMissing"));
        return;
      }
      const checkout = new URL(checkoutUrl);
      if (!(
        (checkout.protocol === "https:" &&
          checkout.hostname === "checkout.stripe.com") ||
        (checkout.origin === window.location.origin &&
          checkout.pathname ===
            `/${encodeURIComponent(locale)}/checkout/demo` &&
          checkout.searchParams.get("orderId") === order.data.id)
      )) {
        setError(t("errors.invalidPaymentLink"));
        return;
      }
      window.location.assign(checkout.toString());
    } catch {
      setError(t("errors.checkoutUnavailable"));
    } finally {
      setCheckingOut(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t("emptyTitle")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{t("emptyDescription")}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
      <section className="space-y-4">
        {items.map((item) => (
          <article
            className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            key={getCartItemKey(item)}
          >
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="text-sm text-slate-500">{item.slug}</p>
              {item.variantSelections && (
                <p className="text-sm text-slate-600">
                  {Object.entries(item.variantSelections)
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(" · ")}
                </p>
              )}
              {item.sku && (
                <p className="text-sm text-slate-500">SKU: {item.sku}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                {t("quantity")}
                <input
                  className="w-16 rounded-md border border-slate-300 px-2 py-1"
                  min={1}
                  type="number"
                  value={item.quantity}
                  disabled={checkingOut}
                  onChange={(event) =>
                    updateQuantity(
                      getCartItemKey(item),
                      Number(event.target.value) || 0,
                    )
                  }
                />
              </label>
              <p className="min-w-24 text-right text-sm font-medium text-slate-900">
                {formatCurrencyAmount(
                  item.quantity * item.price,
                  item.currency,
                  locale,
                )}
              </p>
              <button
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                onClick={() => removeItem(getCartItemKey(item))}
                disabled={checkingOut}
                type="button"
              >
                {t("remove")}
              </button>
            </div>
          </article>
        ))}
      </section>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-lg font-semibold text-slate-900">
          {t("orderSummary")}
        </h3>
        {paymentFailed && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {t("demoPaymentFailed")}
          </p>
        )}
        <div className="mt-4 space-y-2 border-y border-slate-200 py-4">
          <label className="block text-sm font-medium text-slate-800">
            {t("discountCode")}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              value={discountCode}
              onChange={(event) => {
                setDiscountCode(event.target.value.toUpperCase());
                setAppliedDiscount(null);
                setDiscountError("");
              }}
              maxLength={40}
              disabled={checkingOut || applyingDiscount}
              placeholder={t("enterCode")}
            />
          </label>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
            type="button"
            disabled={!discountCode.trim() || applyingDiscount || checkingOut}
            onClick={() => void applyDiscount()}
          >
            {applyingDiscount ? t("checking") : t("applyCode")}
          </button>
          {discountError && (
            <p className="text-sm text-red-700" role="alert">
              {discountError}
            </p>
          )}
          {activeDiscount && (
            <p className="text-sm text-green-700" role="status">
              {t("discountApplied", { code: activeDiscount.code })}
            </p>
          )}
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <span>{t("subtotal")}</span>
            <span>
              {formatCurrencyAmount(
                subtotal,
                items[0]?.currency ?? "USD",
                locale,
              )}
            </span>
          </div>
          {discountAmount > 0 && (
            <div className="flex items-center justify-between">
              <span>
                {t("discountWithCode", {
                  code: activeDiscount?.code ?? "",
                })}
              </span>
              <span>
                −
                {formatCurrencyAmount(
                  discountAmount,
                  items[0]?.currency ?? currency,
                  locale,
                )}
              </span>
            </div>
          )}
          {taxAmount > 0 && (
            <div className="flex items-center justify-between">
              <span>{t("tax")}</span>
              <span>
                {formatCurrencyAmount(
                  taxAmount,
                  items[0]?.currency ?? currency,
                  locale,
                )}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span>{t("shipping")}</span>
            <span>
              {formatCurrencyAmount(
                estimatedShipping,
                items[0]?.currency ?? currency,
                locale,
              )}
            </span>
          </div>
          <div className="border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <div className="flex items-center justify-between">
              <span>{t("total")}</span>
              <span>
                {formatCurrencyAmount(
                  shippingCurrencyMismatch
                    ? 0
                    : subtotal - discountAmount + taxAmount + estimatedShipping,
                  items[0]?.currency ?? currency,
                  locale,
                )}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {shippingCurrencyMismatch && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {t("errors.shippingCurrencyMismatch", { currency })}
          </p>
        )}
        {!signedIn && (
          <p className="mt-4 text-sm text-slate-600">
            {t("signInToPlaceOrderDescription")}
          </p>
        )}
        {signedIn ? (
          <div className="mt-5 space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-slate-800">
                {t("paymentMethod")}
              </legend>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  checked={paymentMethod === "stripe"}
                  disabled={checkingOut}
                  name="paymentMethod"
                  onChange={() => {
                    setPaymentMethod("stripe");
                    idempotencyKey.current = crypto.randomUUID();
                  }}
                  type="radio"
                  value="stripe"
                />
                {t("cardPayment")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  checked={paymentMethod === "cash_on_delivery"}
                  disabled={checkingOut || !supportsCashOnDelivery}
                  name="paymentMethod"
                  onChange={() => {
                    setPaymentMethod("cash_on_delivery");
                    idempotencyKey.current = crypto.randomUUID();
                  }}
                  type="radio"
                  value="cash_on_delivery"
                />
                {t("cashOnDelivery")}
              </label>
              {!supportsCashOnDelivery && (
                <p className="text-xs text-slate-500">
                  {t("cashOnDeliveryInrOnly")}
                </p>
              )}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-800">
                {t("deliveryAddress")}
              </legend>
              {(
                [
                  ["fullName", "fullName", "text"],
                  ["line1", "addressLine1", "text"],
                  ["line2", "addressLine2Optional", "text"],
                  ["city", "city", "text"],
                  ["state", "state", "text"],
                  ["postalCode", "pinCode", "text"],
                  ["phone", "mobileNumber", "tel"],
                ] as const
              ).map(([field, label, type]) => (
                <label
                  className="block space-y-1 text-xs font-medium text-slate-600"
                  key={field}
                >
                  {t(label)}
                  <input
                    autoComplete={
                      field === "fullName"
                        ? "name"
                        : field === "line1"
                          ? "address-line1"
                          : field === "line2"
                            ? "address-line2"
                            : field === "postalCode"
                              ? "postal-code"
                              : field === "phone"
                                ? "tel"
                                : "address-level2"
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    disabled={checkingOut}
                    onChange={(event) => {
                      setDeliveryAddress((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }));
                      idempotencyKey.current = crypto.randomUUID();
                    }}
                    required={field !== "line2"}
                    type={type}
                    value={deliveryAddress[field]}
                  />
                </label>
              ))}
              <p className="text-xs text-slate-500">
                {paymentMethod === "cash_on_delivery"
                  ? t("deliveryIndiaCod")
                  : t("deliveryIndia")}
              </p>
            </fieldset>
            <button
              className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={
                checkingOut ||
                shippingCurrencyMismatch ||
                (paymentMethod === "cash_on_delivery" &&
                  !supportsCashOnDelivery)
              }
              onClick={onCheckout}
              type="button"
            >
              {checkingOut
                ? t("placingOrder")
                : paymentMethod === "cash_on_delivery"
                  ? t("placeCashOnDeliveryOrder")
                  : t("continueToSecurePayment")}
            </button>
          </div>
        ) : (
          <Link
            className="mt-6 inline-flex w-full justify-center rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            href={`/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`}
          >
            {t("signInToPlaceOrder")}
          </Link>
        )}
      </aside>
    </div>
  );
}
