import "server-only";
import { randomUUID } from "node:crypto";
import { Agent } from "node:https";
import type { LookupFunction } from "node:net";
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { TenantStorageProviderConfig } from "@/core/domain/tenant-config";
import type {
  FileMeta,
  StoragePort,
  StoredFile,
  UploadTarget,
} from "@/core/ports/storage";
import { resolvePublicAddress } from "@/adapters/data/rest/health-check";
import {
  assertTenantStorageKey,
  extensionForImageType,
  MAX_UPLOAD_BYTES,
  validateImageContent,
  validateUploadMeta,
} from "./upload-validation";

type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

const publicLookup: LookupFunction = (hostname, _options, callback) => {
  void resolvePublicAddress(hostname)
    .then((resolved) => {
      if (!resolved) {
        callback(
          new Error("Storage endpoint resolved to a non-public address"),
          "",
          0,
        );
        return;
      }
      callback(null, resolved.address, resolved.family);
    })
    .catch(() => {
      callback(new Error("Storage endpoint DNS lookup failed"), "", 0);
    });
};

async function readUploadStream(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES || size > expectedSize) {
        await reader.cancel();
        throw new Error("Upload exceeded its validated size");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedSize) {
    throw new Error("Upload size changed while it was being read");
  }
  return Buffer.concat(chunks, size);
}

export class TenantS3StorageAdapter implements StoragePort {
  readonly capabilities = {
    presignedUploads: false,
    publicCdn: true,
    imageTransforms: false,
    oauth: false,
  } as const;

  private readonly client: S3Client;

  constructor(
    private readonly config: TenantStorageProviderConfig,
    private readonly tenantId: string,
    credentials: S3Credentials,
  ) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.pathStyle,
      credentials,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({ keepAlive: false, lookup: publicLookup }),
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
      }),
    });
  }

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
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: meta.contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
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
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "The configured storage bucket could not be reached.",
      };
    }
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Storage operation is outside the configured tenant scope",
      );
    }
  }
}
