import { describe, expect, it } from "vitest";
import { formatCurrencyAmount } from "./money";

describe("formatCurrencyAmount", () => {
  it("formats currency values stored in minor units", () => {
    expect(formatCurrencyAmount(5600, "USD", "en-US")).toBe("$56.00");
    expect(formatCurrencyAmount(5600, "EUR", "en-US")).toBe("€56.00");
  });

  it("honors currencies that do not have fractional minor units", () => {
    expect(formatCurrencyAmount(5600, "JPY", "en-US")).toBe("¥5,600");
  });
});
