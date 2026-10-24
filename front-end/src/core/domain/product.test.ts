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
});
