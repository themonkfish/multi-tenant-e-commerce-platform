import type { StoragePort } from "@/core/ports/storage";
import { assertTenantStorageKey } from "@/adapters/storage/s3/upload-validation";

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getTenantUploadedImageKey(
  tenantId: string,
  imageUrl: string,
): string | null {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const match = pathname.match(
    new RegExp(
      `(?:^|/)(${escaped(tenantId)}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|webp))(?=$|/)`,
      "i",
    ),
  );
  return match?.[1] ?? null;
}

export function validateTenantUploadedImageUrl(
  storage: StoragePort,
  tenantId: string,
  imageUrl: string,
): string | null {
  const key = getTenantUploadedImageKey(tenantId, imageUrl);
  if (!key) return null;
  assertTenantStorageKey(tenantId, key);
  const expected = new URL(storage.getPublicUrl(key));
  const actual = new URL(imageUrl);
  if (expected.href !== actual.href) {
    throw new Error("Product image does not belong to this tenant storage");
  }
  return key;
}
