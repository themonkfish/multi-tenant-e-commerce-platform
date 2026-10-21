"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { Product } from "@/core/ports/data";

type DraftProduct = {
  title: string;
  slug: string;
  status: Product["status"];
  price: { amount: number; currency: string };
  sku: string;
};

const EMPTY_DRAFT: DraftProduct = {
  title: "",
  slug: "",
  status: "draft",
  price: { amount: 0, currency: "USD" },
  sku: "",
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
  };
}

export function TenantProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftProduct>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalCount = useMemo(() => products.length, [products]);

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
            : "Could not load products.";
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
      setError(err instanceof Error ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, []);

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

    const payload = {
      title: draft.title.trim(),
      slug: draft.slug.trim(),
      status: draft.status,
      price: {
        amount: Number(draft.price.amount),
        currency: draft.price.currency.trim().toUpperCase(),
      },
      ...(draft.sku.trim() ? { sku: draft.sku.trim() } : {}),
    };

    if (!payload.title || !payload.slug || !payload.price.currency) {
      setError("Title, slug, and currency are required.");
      setSaving(false);
      return;
    }

    if (!Number.isInteger(payload.price.amount) || payload.price.amount < 0) {
      setError("Price must be a non-negative whole number.");
      setSaving(false);
      return;
    }

    if (!/^[A-Z]{3}$/.test(payload.price.currency)) {
      setError("Currency must be a valid three-letter code such as USD.");
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
            : "The product could not be saved.";
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
      setNotice(
        editingId
          ? "Product updated successfully."
          : "Product created successfully.",
      );
      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The product could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(productId: string) {
    const confirmed = window.confirm("Delete this product?");
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
            : "Could not delete product.";
        throw new Error(message);
      }
      setProducts((current) =>
        current.filter((product) => product.id !== productId),
      );
      if (editingId === productId) {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
      }
      setNotice("Product deleted.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete product.",
      );
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Product catalog
          </h2>
          <p className="text-sm text-slate-600">
            {loading
              ? "Loading products…"
              : `${totalCount} product${totalCount === 1 ? "" : "s"} available`}
          </p>
        </div>
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
          onClick={() => {
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setNotice(null);
          }}
          type="button"
        >
          New product
        </button>
      </div>

      <form
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
        onSubmit={handleSubmit}
      >
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Product title
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Trail running cap"
            required
          />
        </label>

        <label className="space-y-1 text-sm font-medium">
          Slug
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={draft.slug}
            onChange={(event) =>
              setDraft((current) => ({ ...current, slug: event.target.value }))
            }
            placeholder="trail-running-cap"
            required
          />
        </label>

        <label className="space-y-1 text-sm font-medium">
          Status
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
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Price amount
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
          Currency
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
          SKU (optional)
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={draft.sku}
            onChange={(event) =>
              setDraft((current) => ({ ...current, sku: event.target.value }))
            }
            placeholder="SKU-001"
          />
        </label>

        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button
            className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving…" : editingId ? "Save changes" : "Create product"}
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
              Cancel edit
            </button>
          )}
        </div>
      </form>

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
          <div className="p-5 text-sm text-slate-600">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="p-5 text-sm text-slate-600">
            No products yet. Create the first catalog item from the form above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
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
                        {product.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {product.price.amount} {product.price.currency}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                          onClick={() => {
                            setEditingId(product.id);
                            setDraft(toDraft(product));
                            setNotice(null);
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                          onClick={() => void handleDelete(product.id)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
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
