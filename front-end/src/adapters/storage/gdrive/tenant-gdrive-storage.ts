import "server-only";
import type { StorageProviderConfig } from "@/core/domain/tenant-config";
import type {
  FileMeta,
  StoredFile,
  StoragePort,
  UploadTarget,
} from "@/core/ports/storage";
import { getServerEnv } from "@/lib/server/env";

type GoogleDriveCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class TenantGoogleDriveStorageAdapter implements StoragePort {
  capabilities = {
    presignedUploads: false,
    publicCdn: false,
    imageTransforms: false,
    oauth: true,
  } as const;

  constructor(
    private readonly config: {
      type: "gdrive";
      folderId: string;
      oauthTokenRef: string;
      accountEmail: string;
    },
    private readonly tenantId: string,
    private readonly credentials: GoogleDriveCredentials,
  ) {}

  async prepareUpload(file: FileMeta): Promise<UploadTarget> {
    if (file.tenantId !== this.tenantId) {
      throw new Error("Google Drive upload scope does not match the tenant");
    }
    return {
      mode: "server-proxy",
      key: `tenants/${this.tenantId}/${crypto.randomUUID()}-${file.fileName}`,
    };
  }

  getPublicUrl(key: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(key)}/view`;
  }

  async upload(
    key: string,
    data: ReadableStream<Uint8Array>,
  ): Promise<StoredFile> {
    const token = await this.getAccessToken();
    const form = new FormData();
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            name: key.split("/").pop(),
            parents: [this.config.folderId],
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append("file", new Blob([await new Response(data).arrayBuffer()]));
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
        body: form,
      },
    );
    if (!response.ok) throw new Error("Google Drive upload failed");
    const body = (await response.json()) as {
      id: string;
      name: string;
      mimeType?: string;
      size?: string;
    };
    return {
      key: body.id,
      url: this.getPublicUrl(body.id),
      contentType: body.mimeType ?? "application/octet-stream",
      size: body.size ? Number(body.size) : 0,
    };
  }

  async delete(key: string): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("Google Drive deletion failed");
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      const token = await this.getAccessToken();
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.config.folderId)}?fields=id,name,mimeType`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        ...(response.ok ? {} : { details: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: error instanceof Error ? error.message : "Google Drive unavailable",
      };
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.credentials.expiresAt > Date.now() + 60_000) {
      return this.credentials.accessToken;
    }
    const env = getServerEnv();
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
      throw new Error("Google Drive OAuth credentials are not configured");
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        client_id: env.GOOGLE_DRIVE_CLIENT_ID,
        client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
        refresh_token: this.credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!response.ok || !body?.access_token) {
      throw new Error("Google Drive OAuth token refresh failed");
    }
    this.credentials.accessToken = body.access_token;
    this.credentials.expiresAt =
      Date.now() + (body.expires_in ?? 3600) * 1000;
    return body.access_token;
  }
}
