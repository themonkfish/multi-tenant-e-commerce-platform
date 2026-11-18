import { describe, expect, it } from "vitest";
import { routing } from "./routing";

describe("application locale routing", () => {
  it("supports English, French, and Hindi", () => {
    expect(routing.locales).toEqual(["en", "fr", "hi"]);
    expect(routing.defaultLocale).toBe("en");
  });

  it("always prefixes localized routes", () => {
    expect(routing.localePrefix).toBe("always");
  });
});
