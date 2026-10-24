import { describe, expect, it } from "vitest";
import {
  ProductInputSchema,
  ProductOptionsSchema,
  ProductVariantSelectionsSchema,
  ProductUpdateSchema,
} from "./product";

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

describe("product options", () => {
  it("accepts bounded option groups and normalizes their text", () => {
    expect(
      ProductInputSchema.parse({
        ...product,
        options: [{ name: " Size ", values: [" S ", "M"] }],
      }).options,
    ).toEqual([{ name: "Size", values: ["S", "M"] }]);
    expect(
      ProductUpdateSchema.parse({
        options: [{ name: "Color", values: ["Black", "Blue"] }],
      }).options,
    ).toEqual([{ name: "Color", values: ["Black", "Blue"] }]);
  });

  it("rejects duplicate names or values and excessive options", () => {
    expect(
      ProductOptionsSchema.safeParse([
        { name: "Size", values: ["S"] },
        { name: "size", values: ["M"] },
      ]).success,
    ).toBe(false);
    expect(
      ProductOptionsSchema.safeParse([
        { name: "Color", values: ["Black", "black"] },
      ]).success,
    ).toBe(false);
    expect(
      ProductOptionsSchema.safeParse(
        Array.from({ length: 4 }, (_, index) => ({
          name: `Option ${index}`,
          values: ["Value"],
        })),
      ).success,
    ).toBe(false);
  });

  it("bounds the number and length of variant selections", () => {
    expect(
      ProductVariantSelectionsSchema.safeParse({
        One: "1",
        Two: "2",
        Three: "3",
        Four: "4",
      }).success,
    ).toBe(false);
    expect(
      ProductVariantSelectionsSchema.safeParse({
        ["x".repeat(41)]: "value",
      }).success,
    ).toBe(false);
  });
});
