import { afterEach, describe, expect, it } from "vitest";
import { getCartItemKey, useCartStore } from "./cart-store";

afterEach(() => {
  useCartStore.getState().clear();
});

describe("storefront cart product variants", () => {
  it("keeps different selections in separate lines and increments matching selections", () => {
    const { addItem } = useCartStore.getState();
    const common = {
      id: "product-1",
      slug: "canvas-bag",
      title: "Canvas bag",
      price: 1250,
      currency: "INR",
    };

    addItem({ ...common, variantSelections: { Size: "S", Color: "Blue" } });
    addItem({ ...common, variantSelections: { Color: "Blue", Size: "S" } });
    addItem({ ...common, variantSelections: { Size: "M", Color: "Blue" } });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.quantity)).toEqual([2, 1]);
  });

  it("updates and removes only the selected cart line", () => {
    const { addItem } = useCartStore.getState();
    const common = {
      id: "product-1",
      slug: "canvas-bag",
      title: "Canvas bag",
      price: 1250,
      currency: "INR",
    };
    addItem({ ...common, variantSelections: { Size: "S" } });
    addItem({ ...common, variantSelections: { Size: "M" } });

    const firstLine = useCartStore.getState().items[0];
    const lineKey = getCartItemKey(firstLine);
    useCartStore.getState().updateQuantity(lineKey, 3);

    expect(useCartStore.getState().items.map((item) => item.quantity)).toEqual([
      3, 1,
    ]);
    useCartStore.getState().removeItem(lineKey);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].variantSelections).toEqual({
      Size: "M",
    });
  });
});
