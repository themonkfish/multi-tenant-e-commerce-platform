import { z } from "zod";
import type { FileMeta } from "@/core/ports/storage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedImageMimeType = keyof typeof MIME_EXTENSIONS;

const FileMetaSchema = z.object({
  tenantId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export function validateUploadMeta(
  meta: FileMeta,
): z.infer<typeof FileMetaSchema> {
  const parsed = FileMetaSchema.safeParse(meta);
  if (!parsed.success) {
    throw new Error("Upload metadata is invalid or exceeds the file limit");
  }
  if (/[/\\\x00-\x1f\x7f]/.test(parsed.data.fileName)) {
    throw new Error(
      "Upload file name must not contain path or control characters",
    );
  }
  return parsed.data;
}

export function detectImageMimeType(
  data: Uint8Array,
): AllowedImageMimeType | null {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageContent(
  data: Uint8Array,
  contentType: string,
): asserts contentType is AllowedImageMimeType {
  const detected = detectImageMimeType(data);
  if (!detected || detected !== contentType) {
    throw new Error("File content does not match an allowed image type");
  }
}

export function assertTenantStorageKey(tenantId: string, key: string): void {
  if (
    !z.uuid().safeParse(tenantId).success ||
    !key.startsWith(`${tenantId}/`) ||
    key.includes("\\") ||
    key.split("/").some((part) => !part || part === "." || part === "..") ||
    !new RegExp(
      `^${tenantId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp)$`,
      "i",
    ).test(key)
  ) {
    throw new Error("Storage key is outside this tenant's upload scope");
  }
}

export function extensionForImageType(contentType: AllowedImageMimeType) {
  return MIME_EXTENSIONS[contentType];
}
