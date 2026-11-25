import "server-only";
import { createHmac, randomUUID } from "node:crypto";
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

type AzureCredentials = {
  accountName: string;
  accountKey: string;
};

export class TenantAzureStorageAdapter implements StoragePort {
  readonly capabilities = {
    presignedUploads: false,
    publicCdn: true,
    imageTransforms: false,
    oauth: false,
  } as const;

  constructor(
    private readonly config: Extract<
      TenantStorageProviderConfig,
      { type: "azure" }
    >,
    private readonly tenantId: string,
    private readonly credentials: AzureCredentials,
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

    const endpoint = this.blobEndpoint(key);
    const now = new Date().toUTCString();
    const msHeaders = {
      "x-ms-blob-type": "BlockBlob",
      "x-ms-date": now,
      "x-ms-version": "2021-12-02",
    };
    const authorization = this.authorize({
      method: "PUT",
      path: `/${this.credentials.accountName}/${this.config.container}/${key}`,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": meta.contentType,
        ...msHeaders,
      },
      query: "",
    });
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": meta.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...msHeaders,
      },
      body: Uint8Array.from(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Azure Blob upload failed with HTTP ${response.status}`);
    }
    return {
      key,
      url: this.getPublicUrl(key),
      contentType: meta.contentType,
      size: bytes.byteLength,
    };
  }

  getPublicUrl(key: string): string {
    assertTenantStorageKey(this.tenantId, key);
    const baseUrl = new URL(this.config.publicBaseUrl);
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    const objectPath = key.split("/").map(encodeURIComponent).join("/");
    baseUrl.pathname = `${basePath}/${objectPath}`;
    return baseUrl.toString();
  }

  async delete(key: string): Promise<void> {
    assertTenantStorageKey(this.tenantId, key);
    const endpoint = this.blobEndpoint(key);
    const now = new Date().toUTCString();
    const msHeaders = {
      "x-ms-date": now,
      "x-ms-version": "2021-12-02",
    };
    const authorization = this.authorize({
      method: "DELETE",
      path: `/${this.credentials.accountName}/${this.config.container}/${key}`,
      headers: msHeaders,
      query: "",
    });
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: authorization, ...msHeaders },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Azure Blob delete failed with HTTP ${response.status}`);
    }
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      const endpoint = `${this.accountEndpoint()}?restype=container&comp=list&maxresults=1`;
      const now = new Date().toUTCString();
      const msHeaders = {
        "x-ms-date": now,
        "x-ms-version": "2021-12-02",
      };
      const authorization = this.authorize({
        method: "GET",
        path: `/${this.credentials.accountName}/${this.config.container}`,
        headers: msHeaders,
        query: "comp:list\nrestype:container\nmaxresults:1",
      });
      const response = await fetch(endpoint, {
        headers: { Authorization: authorization, ...msHeaders },
        signal: AbortSignal.timeout(30_000),
      });
      return response.ok
        ? { ok: true, latencyMs: Date.now() - startedAt }
        : {
            ok: false,
            latencyMs: Date.now() - startedAt,
            details: "The configured Azure Blob container could not be reached.",
          };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "The configured Azure Blob credentials could not be used.",
      };
    }
  }

  private accountEndpoint(): string {
    return `https://${this.credentials.accountName}.blob.core.windows.net/${this.config.container}`;
  }

  private blobEndpoint(key: string): string {
    return `${this.accountEndpoint()}/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  private authorize(input: {
    method: "GET" | "PUT" | "DELETE";
    path: string;
    headers: Record<string, string>;
    query: string;
  }): string {
    const normalized = Object.entries(input.headers).reduce(
      (values, [name, value]) => {
        values[name.toLowerCase()] = value;
        return values;
      },
      {} as Record<string, string>,
    );
    const canonicalHeaders = Object.entries(normalized)
      .filter(([name]) => name.startsWith("x-ms-"))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}:${value.trim()}`)
      .join("\n");
    const stringToSign = [
      input.method,
      "",
      "",
      normalized["content-length"] ?? "",
      "",
      normalized["content-type"] ?? "",
      "",
      "",
      "",
      "",
      "",
      canonicalHeaders,
      input.query
        ? `${input.path}\n${input.query
            .split("\n")
            .map((line) => line.trim())
            .join("\n")}`
        : input.path,
    ].join("\n");
    const signature = createHmac("sha256", Buffer.from(this.credentials.accountKey, "base64"))
      .update(stringToSign, "utf8")
      .digest("base64");
    return `SharedKey ${this.credentials.accountName}:${signature}`;
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Storage operation is outside the configured tenant scope",
      );
    }
  }
}
