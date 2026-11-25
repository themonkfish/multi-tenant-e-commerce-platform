import "server-only";
import { randomUUID, sign } from "node:crypto";
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

type GcsCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class TenantGcsStorageAdapter implements StoragePort {
  readonly capabilities = {
    presignedUploads: false,
    publicCdn: true,
    imageTransforms: false,
    oauth: false,
  } as const;

  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly config: Extract<
      TenantStorageProviderConfig,
      { type: "gcs" }
    >,
    private readonly tenantId: string,
    private readonly credentials: GcsCredentials,
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
    const token = await this.getAccessToken();
    const endpoint =
      "https://storage.googleapis.com/upload/storage/v1/b/" +
      encodeURIComponent(this.config.bucket) +
      `/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": meta.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body: Uint8Array.from(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`GCS upload failed with HTTP ${response.status}`);
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
    const token = await this.getAccessToken();
    const endpoint =
      "https://storage.googleapis.com/storage/v1/b/" +
      encodeURIComponent(this.config.bucket) +
      `/o/${encodeURIComponent(key)}`;
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`GCS delete failed with HTTP ${response.status}`);
    }
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      const token = await this.getAccessToken();
      const endpoint =
        "https://storage.googleapis.com/storage/v1/b/" +
        encodeURIComponent(this.config.bucket) +
        "/o?maxResults=1";
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      return response.ok
        ? { ok: true, latencyMs: Date.now() - startedAt }
        : {
            ok: false,
            latencyMs: Date.now() - startedAt,
            details: "The configured GCS bucket could not be reached.",
          };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "The configured GCS credentials could not be used.",
      };
    }
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.accessToken.expiresAt > Date.now() + 60_000
    ) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: "https://www.googleapis.com/auth/devstorage.read_write",
        aud: this.credentials.token_uri ?? "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const signature = sign("RSA-SHA256", Buffer.from(unsigned), {
      key: this.credentials.private_key,
    });
    const assertion = `${unsigned}.${base64Url(signature)}`;
    const response = await fetch(
      this.credentials.token_uri ?? "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`GCS OAuth token failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      throw new Error("GCS OAuth token response did not contain an access token");
    }
    const expiresIn = body.expires_in ?? 3600;
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return body.access_token;
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Storage operation is outside the configured tenant scope",
      );
    }
  }
}
