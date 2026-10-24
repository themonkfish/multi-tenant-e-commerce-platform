import { describe, expect, it } from "vitest";
import { ProductInputSchema, ProductUpdateSchema } from "./product";

const product = {
  title: "Canvas bag",
  slug: "canvas-bag",
  status: "active" as const,
  price: { amount: 1999, currency: "USD" },
};

describe("product image URL", () => {
  it("accepts HTTPS image URLs and allows clearing an existing image", () => {
    expect(
      ProductInputSchema.parse({
        ...product,
        imageUrl: "https://cdn.example.com/products/bag.jpg",
      }).imageUrl,
    ).toBe("https://cdn.example.com/products/bag.jpg");
    expect(ProductUpdateSchema.parse({ imageUrl: null })).toEqual({
      imageUrl: null,
    });
  });

  it("rejects non-HTTPS image URLs", () => {
    expect(
      ProductInputSchema.safeParse({
        ...product,
        imageUrl: "http://cdn.example.com/products/bag.jpg",
      }).success,
    ).toBe(false);
  });

  it("accepts a category and rejects blank or oversized category names", () => {
    expect(
      ProductInputSchema.parse({ ...product, category: " Accessories " })
        .category,
    ).toBe("Accessories");
    expect(
      ProductInputSchema.safeParse({ ...product, category: " " }).success,
    ).toBe(false);
    expect(
      ProductInputSchema.safeParse({
        ...product,
        category: "x".repeat(81),
      }).success,
    ).toBe(false);
  });
});
