"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { Product } from "@/core/ports/data";
import {
  ProductOptionsSchema,
  ProductVariantPricingListSchema,
  ProductVariantsSchema,
} from "@/core/domain/product";

type DraftProduct = {
  title: string;
  slug: string;
  status: Product["status"];
  price: { amount: number; currency: string };
  sku: string;
  category: string;
  imageUrl: string;
  optionsText: string;
  inventoryText: string;
  variantPricingText: string;
};

const EMPTY_DRAFT: DraftProduct = {
  title: "",
  slug: "",
  status: "draft",
  price: { amount: 0, currency: "USD" },
  sku: "",
  category: "",
  imageUrl: "",
  optionsText: "",
  inventoryText: "",
  variantPricingText: "",
};

function toDraft(product?: Product | null): DraftProduct {
  if (!product) {
    return EMPTY_DRAFT;
  }
  return {
    title: product.title,
    slug: product.slug,
    status: product.status,
    price: {
      amount: product.price.amount,
      currency: product.price.currency,
    },
    sku: product.sku ?? "",
    category: product.category ?? "",
    imageUrl: product.imageUrl ?? "",
    optionsText: (product.options ?? [])
      .map((option) => `${option.name}: ${option.values.join(", ")}`)
      .join("\n"),
    inventoryText: (product.variants ?? [])
      .map((variant) => {
        const selection = Object.entries(variant.selections)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ");
        return `${selection || "Stock"}: ${variant.stock}`;
      })
      .join("\n"),
    variantPricingText: (product.variantPricing ?? [])
      .map((variant) => {
        const selection = Object.entries(variant.selections)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ");
        const values = [
          ...(variant.amount === undefined ? [] : [`price=${variant.amount}`]),
          ...(variant.sku ? [`sku=${variant.sku}`] : []),
        ];
        return `${selection}: ${values.join("; ")}`;
      })
      .join("\n"),
  };
}

export function TenantProductManagement({
  canWrite = true,
}: {
  canWrite?: boolean;
}) {
  const t = useTranslations("TenantCatalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftProduct>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalCount = useMemo(() => products.length, [products]);

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingImage(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/tenant/storage/upload", {
        method: "POST",
        body: formData,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : t("imageUploadFailed");
        throw new Error(message);
      }
      const storedFile =
        typeof body === "object" && body !== null && "file" in body
          ? body.file
          : null;
      const imageUrl =
        typeof storedFile === "object" &&
        storedFile !== null &&
        "url" in storedFile &&
        typeof storedFile.url === "string"
          ? storedFile.url
          : null;
      if (!imageUrl || new URL(imageUrl).protocol !== "https:") {
        throw new Error(t("invalidUploadedImage"));
      }
      setDraft((current) => ({ ...current, imageUrl }));
      setNotice(t("imageUploaded"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("imageUploadFailed"));
    } finally {
      setUploadingImage(false);
    }
  }

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tenant/products?page=1&limit=20", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : t("loadFailed");
        throw new Error(message);
      }
      const payload = typeof body === "object" && body !== null ? body : null;
      const items =
        payload && "data" in payload && Array.isArray(payload.data)
          ? payload.data
          : [];
      setProducts(
        items.filter(
          (item): item is Product =>
            typeof item === "object" && item !== null && "id" in item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProducts();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadProducts]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const existingImageUrl = editingId
      ? products.find((product) => product.id === editingId)?.imageUrl
      : null;
    const existingCategory = editingId
      ? products.find((product) => product.id === editingId)?.category
      : null;
    const payload = {
      title: draft.title.trim(),
      slug: draft.slug.trim(),
      status: draft.status,
      price: {
        amount: Number(draft.price.amount),
        currency: draft.price.currency.trim().toUpperCase(),
      },
      ...(draft.imageUrl.trim()
        ? { imageUrl: draft.imageUrl.trim() }
        : existingImageUrl
          ? { imageUrl: null }
          : {}),
      ...(draft.sku.trim() ? { sku: draft.sku.trim() } : {}),
      ...(draft.category.trim()
        ? { category: draft.category.trim() }
        : existingCategory
          ? { category: null }
          : {}),
      options: draft.optionsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(":");
          if (separator < 1) return { name: line, values: [] };
          return {
            name: line.slice(0, separator).trim(),
            values: line
              .slice(separator + 1)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          };
        }),
      variants: draft.inventoryText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.lastIndexOf(":");
          const selectionsText =
            separator < 0 ? "" : line.slice(0, separator).trim();
          const quantity =
            separator < 0 ? Number.NaN : Number(line.slice(separator + 1));
          const selections =
            selectionsText === "" || selectionsText === "Stock"
              ? {}
              : Object.fromEntries(
                  selectionsText.split(",").map((part) => {
                    const equals = part.indexOf("=");
                    return equals < 1
                      ? [part.trim(), ""]
                      : [
                          part.slice(0, equals).trim(),
                          part.slice(equals + 1).trim(),
                        ];
                  }),
                );
          return { selections, stock: quantity };
        }),
      variantPricing: draft.variantPricingText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.lastIndexOf(":");
          const selectionsText =
            separator < 0 ? "" : line.slice(0, separator).trim();
          const attributes =
            separator < 0 ? [] : line.slice(separator + 1).split(";");
          const selections = Object.fromEntries(
            selectionsText.split(",").map((part) => {
              const equals = part.indexOf("=");
              return equals < 1
                ? [part.trim(), ""]
                : [part.slice(0, equals).trim(), part.slice(equals + 1).trim()];
            }),
          );
          const values = Object.fromEntries(
            attributes.map((attribute) => {
              const equals = attribute.indexOf("=");
              return equals < 1
                ? [attribute.trim().toLowerCase(), ""]
                : [
                    attribute.slice(0, equals).trim().toLowerCase(),
                    attribute.slice(equals + 1).trim(),
                  ];
            }),
          );
          const amountText = values.price;
          return {
            selections,
            ...(amountText ? { amount: Number(amountText) } : {}),
            ...(values.sku ? { sku: values.sku } : {}),
          };
        }),
    };

    if (!payload.title || !payload.slug || !payload.price.currency) {
      setError(t("titleSlugCurrencyRequired"));
      setSaving(false);
      return;
    }

    if (!Number.isInteger(payload.price.amount) || payload.price.amount < 0) {
      setError(t("priceWholeNumber"));
      setSaving(false);
      return;
    }

    if (!/^[A-Z]{3}$/.test(payload.price.currency)) {
      setError(t("currencyInvalid"));
      setSaving(false);
      return;
    }
    if (!ProductOptionsSchema.safeParse(payload.options).success) {
      setError(t("optionsInvalid"));
      setSaving(false);
      return;
    }
    if (
      payload.variants &&
      !ProductVariantsSchema.safeParse(payload.variants).success
    ) {
      setError(t("stockInvalid"));
      setSaving(false);
      return;
    }
    if (
      !ProductVariantPricingListSchema.safeParse(payload.variantPricing).success
    ) {
      setError(t("variantInvalid"));
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(
        editingId
          ? `/api/tenant/products/${encodeURIComponent(editingId)}`
          : "/api/tenant/products",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : t("saveFailed");
        throw new Error(message);
      }

      const result =
        typeof body === "object" && body !== null && "product" in body
          ? body.product
          : null;
      if (editingId && result && typeof result === "object") {
        setProducts((current) =>
          current.map((product) =>
            product.id === editingId
              ? ({ ...product, ...(result as Product) } as Product)
              : product,
          ),
        );
      } else {
        setProducts((current) => [
          ...(result && typeof result === "object" ? [result as Product] : []),
          ...current,
        ]);
      }

      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setNotice(editingId ? t("productUpdated") : t("productCreated"));
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(productId: string) {
    const confirmed = window.confirm(t("deleteConfirm"));
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/tenant/products/${encodeURIComponent(productId)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json();
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : t("deleteFailed");
        throw new Error(message);
      }
      setProducts((current) =>
        current.filter((product) => product.id !== productId),
      );
      if (editingId === productId) {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
      }
      setNotice(t("productDeleted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {t("catalogTitle")}
          </h2>
          <p className="text-sm text-slate-600">
            {loading
              ? t("loadingProducts")
              : t("productsAvailable", { count: totalCount })}
          </p>
        </div>
        {canWrite && (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
            disabled={uploadingImage}
            onClick={() => {
              setEditingId(null);
              setDraft(EMPTY_DRAFT);
              setNotice(null);
            }}
            type="button"
          >
            {t("newProduct")}
          </button>
        )}
      </div>

      {canWrite && (
        <form
          className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("productTitle")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Trail running cap"
              required
            />
          </label>

          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("variantStock")}
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm font-normal"
              rows={4}
              value={draft.inventoryText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inventoryText: event.target.value,
                }))
              }
              placeholder={"Size=S, Color=Blue: 10\nSize=M, Color=Blue: 4"}
            />
            <span className="block font-normal text-slate-600">
              {t("variantStockHelp")}
            </span>
          </label>

          <label className="space-y-1 text-sm font-medium">
            {t("slug")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={draft.slug}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  slug: event.target.value,
                }))
              }
              placeholder="trail-running-cap"
              required
            />
          </label>

          <label className="space-y-1 text-sm font-medium">
            {t("status")}
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as Product["status"],
                }))
              }
            >
              <option value="draft">{t("draft")}</option>
              <option value="active">{t("active")}</option>
              <option value="archived">{t("archived")}</option>
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium">
            {t("priceAmount")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              min={0}
              step={1}
              type="number"
              value={draft.price.amount}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  price: {
                    ...current.price,
                    amount: Number(event.target.value),
                  },
                }))
              }
              required
            />
          </label>

          <label className="space-y-1 text-sm font-medium">
            {t("currency")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
              maxLength={3}
              value={draft.price.currency}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  price: {
                    ...current.price,
                    currency: event.target.value,
                  },
                }))
              }
              placeholder="USD"
              required
            />
          </label>

          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("skuOptional")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={draft.sku}
              onChange={(event) =>
                setDraft((current) => ({ ...current, sku: event.target.value }))
              }
              placeholder="SKU-001"
            />
          </label>

          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("categoryOptional")}
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              maxLength={80}
              value={draft.category}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              placeholder="Accessories"
            />
          </label>

          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("optionsOptional")}
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
              rows={3}
              value={draft.optionsText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  optionsText: event.target.value,
                }))
              }
              placeholder={"Size: S, M, L\nColor: Black, Blue"}
            />
            <span className="block font-normal text-slate-600">
              {t("optionsHelp")}
            </span>
          </label>

          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            {t("variantPricingOptional")}
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm font-normal"
              rows={4}
              value={draft.variantPricingText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  variantPricingText: event.target.value,
                }))
              }
              placeholder={
                "Size=S, Color=Blue: price=1299; sku=BAG-S-BLUE\nSize=M, Color=Blue: sku=BAG-M-BLUE"
              }
            />
            <span className="block font-normal text-slate-600">
              {t("variantPricingHelp")}
            </span>
          </label>

          <div className="space-y-2 text-sm font-medium sm:col-span-2">
            <span>{t("productImage")}</span>
            {draft.imageUrl ? (
              <Image
                alt={t("imagePreviewAlt")}
                className="h-40 w-40 rounded-md border border-slate-200 object-cover"
                src={draft.imageUrl}
                width={320}
                height={320}
                unoptimized
              />
            ) : (
              <p className="text-sm font-normal text-slate-600">
                {t("imageUploadHelp")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <input
                accept="image/jpeg,image/png,image/webp"
                className="max-w-full text-sm font-normal"
                disabled={uploadingImage || saving}
                onChange={(event) => void handleImageUpload(event)}
                type="file"
              />
              {draft.imageUrl && (
                <button
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  disabled={uploadingImage || saving}
                  onClick={() =>
                    setDraft((current) => ({ ...current, imageUrl: "" }))
                  }
                  type="button"
                >
                  {t("removeImage")}
                </button>
              )}
              {uploadingImage && (
                <span className="text-sm font-normal text-slate-600">
                  {t("uploading")}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button
              className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
              disabled={saving || uploadingImage}
              type="submit"
            >
              {saving
                ? t("saving")
                : editingId
                  ? t("saveChanges")
                  : t("createProduct")}
            </button>
            {editingId && (
              <button
                className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100"
                disabled={saving}
                onClick={() => {
                  setEditingId(null);
                  setDraft(EMPTY_DRAFT);
                }}
                type="button"
              >
                {t("cancelEdit")}
              </button>
            )}
          </div>
        </form>
      )}

      {(error || notice) && (
        <p
          className={`text-sm ${error ? "text-red-700" : "text-green-700"}`}
          role={error ? "alert" : "status"}
        >
          {error ?? notice}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-5 text-sm text-slate-600">
            {t("loadingProducts")}
          </div>
        ) : products.length === 0 ? (
          <div className="p-5 text-sm text-slate-600">{t("noProducts")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("titleColumn")}</th>
                  <th className="px-4 py-3 font-medium">{t("slugColumn")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusColumn")}</th>
                  <th className="px-4 py-3 font-medium">
                    {t("categoryColumn")}
                  </th>
                  <th className="px-4 py-3 font-medium">{t("priceColumn")}</th>
                  {canWrite && (
                    <th className="px-4 py-3 font-medium">
                      {t("actionsColumn")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr className="border-t border-slate-200" key={product.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {product.title}
                      </div>
                      {product.sku && (
                        <div className="text-xs text-slate-500">
                          {product.sku}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{product.slug}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
                        {t(product.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {product.category ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {product.price.amount} {product.price.currency}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                            disabled={uploadingImage}
                            onClick={() => {
                              setEditingId(product.id);
                              setDraft(toDraft(product));
                              setNotice(null);
                            }}
                            type="button"
                          >
                            {t("edit")}
                          </button>
                          <button
                            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                            onClick={() => void handleDelete(product.id)}
                            type="button"
                          >
                            {t("delete")}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
