"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ProductReview } from "@/core/domain/product-review";

export function ProductReviews({ productId }: { productId: string }) {
  const t = useTranslations("CustomerProduct");
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetch(`/api/products/${encodeURIComponent(productId)}/reviews`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (
          typeof body === "object" &&
          body !== null &&
          "reviews" in body &&
          Array.isArray(body.reviews)
        ) {
          setReviews(body.reviews as ProductReview[]);
        }
      })
      .catch(() => undefined);
  }, [productId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(productId)}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            rating: Number(form.get("rating")),
            title: form.get("title"),
            body: form.get("body"),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            body.error === "review_exists"
            ? t("reviewAlreadyExists")
            : typeof body === "object" &&
                body !== null &&
                "error" in body &&
                body.error === "purchase_required"
              ? t("reviewPurchaseRequired")
              : t("reviewSaveFailed"),
        );
        return;
      }
      if (typeof body === "object" && body !== null && "review" in body) {
        setReviews((current) => [
          body.review as ProductReview,
          ...current.filter(
            (review) =>
              (body.review as ProductReview).customerId !== review.customerId,
          ),
        ]);
      }
      setSaved(true);
      event.currentTarget.reset();
    } catch {
      setError(t("reviewRequestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <h3 className="text-xl font-semibold text-slate-950">
          {t("reviewsTitle")}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{t("reviewEligibility")}</p>
      </div>
      {reviews.length === 0 ? (
        <p className="text-sm text-slate-600">{t("reviewsEmpty")}</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <article
              className="rounded-lg border border-slate-200 p-4"
              key={review.id}
            >
              <p className="font-semibold">
                {review.rating}/5 · {review.title}
              </p>
              <p className="mt-2 text-sm text-slate-600">{review.body}</p>
            </article>
          ))}
        </div>
      )}
      <form
        className="grid gap-3 border-t border-slate-200 pt-5"
        onSubmit={submit}
      >
        <label className="space-y-1 text-sm font-medium">
          {t("reviewRating")}
          <select
            className="block rounded-md border border-slate-300 px-3 py-2"
            name="rating"
            defaultValue="5"
            required
          >
            {[5, 4, 3, 2, 1].map((rating) => (
              <option key={rating} value={rating}>
                {rating}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("reviewTitle")}
          <input
            className="block w-full rounded-md border border-slate-300 px-3 py-2"
            name="title"
            maxLength={120}
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("reviewBody")}
          <textarea
            className="block w-full rounded-md border border-slate-300 px-3 py-2"
            name="body"
            rows={4}
            maxLength={2000}
            required
          />
        </label>
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700" role="status">
            {t("reviewSubmitted")}
          </p>
        )}
        <button
          className="justify-self-start rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? t("reviewSubmitting") : t("reviewSubmit")}
        </button>
      </form>
    </section>
  );
}
