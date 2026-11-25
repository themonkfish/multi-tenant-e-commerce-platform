import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type {
  FileMeta,
  StoredFile,
  StoragePort,
  UploadTarget,
} from "@/core/ports/storage";
import type { TenantStorageProviderConfig } from "@/core/domain/tenant-config";
import {
  assertTenantStorageKey,
  extensionForImageType,
  readUploadStream,
  validateImageContent,
  validateUploadMeta,
} from "../s3/upload-validation";

type CloudinaryCredentials = {
  apiKey: string;
  apiSecret: string;
};

export class TenantCloudinaryStorageAdapter implements StoragePort {
  readonly capabilities = {
    presignedUploads: false,
    publicCdn: true,
    imageTransforms: true,
    oauth: false,
  } as const;

  constructor(
    private readonly config: Extract<
      TenantStorageProviderConfig,
      { type: "cloudinary" }
    >,
    private readonly tenantId: string,
    private readonly credentials: CloudinaryCredentials,
  ) {}

  async prepareUpload(input: FileMeta): Promise<UploadTarget> {
    const meta = validateUploadMeta(input);
    this.assertTenant(meta.tenantId);
    const extension = extensionForImageType(meta.contentType);
    const key = `${this.tenantId}/${randomUUID()}.${extension}`;
    assertTenantStorageKey(this.tenantId, key);
    return { mode: "server-proxy", key };
  }

  async upload(
    key: string,
    data: ReadableStream<Uint8Array>,
    input: FileMeta,
  ): Promise<StoredFile> {
    const meta = validateUploadMeta(input);
    this.assertTenant(meta.tenantId);
    assertTenantStorageKey(this.tenantId, key);
    const bytes = await readUploadStream(data, meta.size);
    validateImageContent(bytes, meta.contentType);

    const publicId = this.publicId(key);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign({ public_id: publicId, timestamp });
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(bytes)], { type: meta.contentType }));
    form.append("api_key", this.credentials.apiKey);
    form.append("timestamp", timestamp);
    form.append("public_id", publicId);
    form.append("signature", signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName)}/image/upload`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Cloudinary upload failed with HTTP ${response.status}`);
    }
    return {
      key,
      url: this.getPublicUrl(key),
      contentType: meta.contentType,
      size: bytes.byteLength,
    };
  }

  getPublicUrl(
    key: string,
    options?: { width?: number; format?: string },
  ): string {
    assertTenantStorageKey(this.tenantId, key);
    const transformations = [
      options?.width ? `w_${Math.max(1, Math.floor(options.width))},c_limit` : "",
      options?.format ? `f_${options.format}` : "",
    ].filter(Boolean);
    const transformPath = transformations.length
      ? `/${transformations.join(",")}`
      : "";
    return `https://res.cloudinary.com/${encodeURIComponent(this.config.cloudName)}/image/upload${transformPath}/${encodeURIComponent(this.publicId(key)).replace(/%2F/g, "/")}`;
  }

  async delete(key: string): Promise<void> {
    assertTenantStorageKey(this.tenantId, key);
    const publicId = this.publicId(key);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign({ public_id: publicId, timestamp });
    const form = new FormData();
    form.append("public_id", publicId);
    form.append("api_key", this.credentials.apiKey);
    form.append("timestamp", timestamp);
    form.append("signature", signature);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName)}/image/destroy`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Cloudinary delete failed with HTTP ${response.status}`);
    }
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      const auth = Buffer.from(
        `${this.credentials.apiKey}:${this.credentials.apiSecret}`,
      ).toString("base64");
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName)}/resources/image?max_results=1`,
        {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(30_000),
        },
      );
      return response.ok
        ? { ok: true, latencyMs: Date.now() - startedAt }
        : {
            ok: false,
            latencyMs: Date.now() - startedAt,
            details: "The configured Cloudinary account could not be reached.",
          };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "The configured Cloudinary credentials could not be used.",
      };
    }
  }

  private publicId(key: string): string {
    return key.replace(/\.(?:jpe?g|png|webp)$/i, "");
  }

  private sign(params: Record<string, string>): string {
    const canonical = Object.entries(params)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return createHash("sha1")
      .update(`${canonical}${this.credentials.apiSecret}`)
      .digest("hex");
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Storage operation is outside the configured tenant scope",
      );
    }
  }
}
