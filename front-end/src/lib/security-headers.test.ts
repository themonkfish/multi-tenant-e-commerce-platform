import { describe, expect, it } from "vitest";
import { getSecurityHeaders } from "./security-headers";

describe("security response headers", () => {
  it("sets baseline headers in every environment", () => {
    expect(getSecurityHeaders(false)).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ]);
  });

  it("adds HSTS only in production", () => {
    expect(getSecurityHeaders(true)).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
    expect(getSecurityHeaders(false)).not.toContainEqual(
      expect.objectContaining({ key: "Strict-Transport-Security" }),
    );
  });
});
