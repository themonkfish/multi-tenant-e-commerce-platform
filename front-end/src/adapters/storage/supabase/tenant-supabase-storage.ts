import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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
  type AllowedImageMimeType,
} from "../s3/upload-validation";

type SupabaseCredentials = { serviceKey: string };

export class TenantSupabaseStorageAdapter implements StoragePort {
  capabilities = {
    presignedUploads: false,
    publicCdn: true,
    imageTransforms: true,
    oauth: false,
  } as const;

  private readonly client;

  constructor(
    private readonly config: Extract<
      TenantStorageProviderConfig,
      { type: "supabase" }
    >,
    private readonly tenantId: string,
    credentials: SupabaseCredentials,
  ) {
    this.client = createClient(config.projectUrl, credentials.serviceKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  async prepareUpload(input: FileMeta): Promise<UploadTarget> {
    const meta = validateUploadMeta(input);
    this.assertTenant(meta.tenantId);
    const extension = extensionForImageType(
      meta.contentType as AllowedImageMimeType,
    );
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
    const { error } = await this.client.storage
      .from(this.config.bucket)
      .upload(key, bytes, {
        contentType: meta.contentType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) throw new Error("Supabase Storage upload failed");
    return {
      key,
      url: this.getPublicUrl(key),
      contentType: meta.contentType,
      size: bytes.byteLength,
    };
  }

  getPublicUrl(key: string): string {
    assertTenantStorageKey(this.tenantId, key);
    const { data } = this.client.storage
      .from(this.config.bucket)
      .getPublicUrl(key);
    return data.publicUrl;
  }

  async delete(key: string): Promise<void> {
    assertTenantStorageKey(this.tenantId, key);
    const { error } = await this.client.storage
      .from(this.config.bucket)
      .remove([key]);
    if (error) throw new Error("Supabase Storage delete failed");
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    const { error } = await this.client.storage
      .from(this.config.bucket)
      .list("", { limit: 1 });
    return error
      ? {
          ok: false,
          latencyMs: Date.now() - startedAt,
          details:
            "The configured Supabase Storage bucket could not be reached.",
        }
      : { ok: true, latencyMs: Date.now() - startedAt };
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Storage operation is outside the configured tenant scope",
      );
    }
  }
}
