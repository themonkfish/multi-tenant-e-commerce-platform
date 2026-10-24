"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
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
            ? "This discount code has expired."
            : code === "discount_minimum_not_met"
              ? "Your subtotal does not meet this code's minimum."
              : code === "discount_limit_reached"
                ? "This discount code has reached its redemption limit."
                : code === "rate_limited"
                  ? "Too many code checks. Wait a few minutes and try again."
                  : "This discount code is invalid or unavailable.",
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
        setDiscountError("The server returned an invalid discount response.");
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
      setDiscountError("The discount code could not be checked. Try again.");
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
      setError("Enter a valid Indian delivery address and +91 mobile number.");
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
        setError("Payment is processing. Check your account before retrying.");
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
            ? "This discount code has reached its redemption limit. Remove it or choose another code."
            : code === "discount_minimum_not_met"
              ? "Your subtotal no longer meets this discount code's minimum."
              : code === "discount_expired"
                ? "This discount code has expired. Remove it or choose another code."
                : code === "discount_currency_unsupported"
                  ? `This discount requires the default store currency (${currency}).`
                  : code === "discount_code_invalid"
                    ? "This discount code is no longer valid."
                    : code === "cart_changed"
                      ? "A product changed, its price was updated, or it is no longer available. Review your cart and try again."
                      : code === "insufficient_stock"
                        ? "One or more variants no longer have enough stock. Review your cart and try again."
                        : code === "connection_not_configured"
                          ? "This store has not connected a product backend, so checkout is unavailable."
                          : code === "tenant_backend_unavailable"
                            ? "The store's product backend is temporarily unavailable. Try again later."
                            : code === "payment_not_configured"
                              ? "Secure checkout is not configured for this store."
                              : code === "payment_provider_unavailable"
                                ? "Secure checkout is temporarily unavailable. Try again later."
                                : code ===
                                    "cash_on_delivery_currency_unsupported"
                                  ? "Cash on delivery is available only for INR orders."
                                  : code === "invalid_cart"
                                    ? "Enter a valid Indian delivery address and mobile number."
                                    : code === "shipping_currency_unsupported"
                                      ? `Shipping rates are configured in ${currency}. Update the store's default currency or shipping settings.`
                                      : code === "free_checkout_not_supported"
                                        ? "Free orders cannot be checked out using card payment."
                                        : code === "idempotency_key_conflict"
                                          ? "This checkout attempt is already associated with a different cart. Refresh the cart and try again."
                                          : code === "rate_limited"
                                            ? "Too many checkout attempts. Wait a few minutes and try again."
                                            : "The order could not be placed. Please try again.",
        );
        return;
      }
      const order =
        typeof body === "object" && body !== null && "order" in body
          ? CustomerOrderSchema.safeParse(body.order)
          : null;
      if (!order?.success) {
        setError("The server returned an invalid checkout response.");
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
        setError("The server did not return a secure payment link.");
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
        setError("The server returned an invalid checkout link.");
        return;
      }
      window.location.assign(checkout.toString());
    } catch {
      setError("Checkout could not reach the server. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">
          Your cart is empty
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Add active products to your cart to place an order.
        </p>
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
                Qty
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
                Remove
              </button>
            </div>
          </article>
        ))}
      </section>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-lg font-semibold text-slate-900">Order summary</h3>
        {paymentFailed && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            The demo payment failed. Your order was not sent to the store; you
            can try checkout again.
          </p>
        )}
        <div className="mt-4 space-y-2 border-y border-slate-200 py-4">
          <label className="block text-sm font-medium text-slate-800">
            Discount code
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
              placeholder="Enter code"
            />
          </label>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
            type="button"
            disabled={!discountCode.trim() || applyingDiscount || checkingOut}
            onClick={() => void applyDiscount()}
          >
            {applyingDiscount ? "Checking…" : "Apply code"}
          </button>
          {discountError && (
            <p className="text-sm text-red-700" role="alert">
              {discountError}
            </p>
          )}
          {activeDiscount && (
            <p className="text-sm text-green-700" role="status">
              {activeDiscount.code} applied.
            </p>
          )}
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
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
              <span>Discount ({activeDiscount?.code})</span>
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
              <span>Tax</span>
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
            <span>Shipping</span>
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
              <span>Total</span>
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
            This store&apos;s shipping rates use {currency}, but your cart uses
            a different currency. Contact the store before checking out.
          </p>
        )}
        {!signedIn && (
          <p className="mt-4 text-sm text-slate-600">
            Sign in to place an order. Your cart will be saved while you sign
            in.
          </p>
        )}
        {signedIn ? (
          <div className="mt-5 space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-slate-800">
                Payment method
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
                Card (secure checkout)
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
                Cash on delivery
              </label>
              {!supportsCashOnDelivery && (
                <p className="text-xs text-slate-500">
                  Cash on delivery is available for INR orders only.
                </p>
              )}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-800">
                Delivery address
              </legend>
              {(
                [
                  ["fullName", "Full name", "text"],
                  ["line1", "Address line 1", "text"],
                  ["line2", "Address line 2 (optional)", "text"],
                  ["city", "City", "text"],
                  ["state", "State", "text"],
                  ["postalCode", "PIN code", "text"],
                  ["phone", "Mobile (+91)", "tel"],
                ] as const
              ).map(([field, label, type]) => (
                <label
                  className="block space-y-1 text-xs font-medium text-slate-600"
                  key={field}
                >
                  {label}
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
                Delivery is currently available within India.
                {paymentMethod === "cash_on_delivery" &&
                  " Pay the store operator when your order is delivered."}
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
                ? "Placing order…"
                : paymentMethod === "cash_on_delivery"
                  ? "Place cash-on-delivery order"
                  : "Continue to secure payment"}
            </button>
          </div>
        ) : (
          <Link
            className="mt-6 inline-flex w-full justify-center rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            href={`/${locale}/customer/login?returnTo=${encodeURIComponent(`/${locale}/cart`)}`}
          >
            Sign in to place order
          </Link>
        )}
      </aside>
    </div>
  );
}
