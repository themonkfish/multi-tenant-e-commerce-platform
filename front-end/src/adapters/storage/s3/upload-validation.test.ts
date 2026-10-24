import { describe, expect, it } from "vitest";
import {
  assertTenantStorageKey,
  detectImageMimeType,
  MAX_UPLOAD_BYTES,
  validateImageContent,
  validateUploadMeta,
} from "./upload-validation";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("S3 upload validation", () => {
  it("detects supported image signatures, not filename extensions", () => {
    expect(detectImageMimeType(pngHeader)).toBe("image/png");
    expect(detectImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(
      "image/jpeg",
    );
    expect(
      detectImageMimeType(
        Uint8Array.from([
          ...Buffer.from("RIFF"),
          0x00,
          0x00,
          0x00,
          0x00,
          ...Buffer.from("WEBP"),
        ]),
      ),
    ).toBe("image/webp");
    expect(detectImageMimeType(Buffer.from("<svg></svg>"))).toBeNull();
    expect(() => validateImageContent(pngHeader, "image/jpeg")).toThrow(
      "does not match",
    );
  });

  it("rejects unsupported content types, oversized files, and unsafe names", () => {
    expect(() =>
      validateUploadMeta({
        tenantId,
        fileName: "image.svg",
        contentType: "image/svg+xml",
        size: 12,
      }),
    ).toThrow("metadata");
    expect(() =>
      validateUploadMeta({
        tenantId,
        fileName: "large.png",
        contentType: "image/png",
        size: MAX_UPLOAD_BYTES + 1,
      }),
    ).toThrow("metadata");
    expect(() =>
      validateUploadMeta({
        tenantId,
        fileName: "..\\secret.png",
        contentType: "image/png",
        size: pngHeader.byteLength,
      }),
    ).toThrow("path");
  });

  it("requires generated tenant-scoped object keys", () => {
    const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`;
    expect(() => assertTenantStorageKey(tenantId, key)).not.toThrow();
    expect(() =>
      assertTenantStorageKey(
        tenantId,
        "550e8400-e29b-41d4-a716-446655440099/550e8400-e29b-41d4-a716-446655440001.png",
      ),
    ).toThrow("outside this tenant");
    expect(() =>
      assertTenantStorageKey(tenantId, `${tenantId}/../secret.png`),
    ).toThrow("outside this tenant");
  });
});
