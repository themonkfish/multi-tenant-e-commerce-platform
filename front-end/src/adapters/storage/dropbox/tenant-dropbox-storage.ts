import "server-only";
import type {
  FileMeta,
  StoredFile,
  StoragePort,
  UploadTarget,
} from "@/core/ports/storage";
import { getServerEnv } from "@/lib/server/env";

type DropboxCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class TenantDropboxStorageAdapter implements StoragePort {
  capabilities = {
    presignedUploads: false,
    publicCdn: false,
    imageTransforms: false,
    oauth: true,
  } as const;

  constructor(
    private readonly config: {
      type: "dropbox";
      folderId: string;
      oauthTokenRef: string;
      accountEmail: string;
    },
    private readonly tenantId: string,
    private readonly credentials: DropboxCredentials,
  ) {}

  async prepareUpload(file: FileMeta): Promise<UploadTarget> {
    if (file.tenantId !== this.tenantId) {
      throw new Error("Dropbox upload scope does not match the tenant");
    }
    return {
      mode: "server-proxy",
      key: `tenants/${this.tenantId}/${crypto.randomUUID()}-${file.fileName}`,
    };
  }

  getPublicUrl(key: string): string {
    const folder = this.normalizeFolder(this.config.folderId);
    return `https://www.dropbox.com/home${folder}/${encodeURIComponent(key.split("/").pop() ?? key)}`;
  }

  async upload(
    key: string,
    data: ReadableStream<Uint8Array>,
  ): Promise<StoredFile> {
    const token = await this.getAccessToken();
    const folder = this.normalizeFolder(this.config.folderId);
    const path = `${folder}/${key.split("/").pop() ?? key}`.replace(/\/+/g, "/");
    const body = await new Response(data).arrayBuffer();
    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "add",
          autorename: true,
          mute: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      signal: AbortSignal.timeout(30_000),
      body,
    });
    if (!response.ok) throw new Error("Dropbox upload failed");
    const uploaded = (await response.json()) as {
      id?: string;
      name?: string;
      size?: number;
    };
    const fileKey = uploaded.id ?? path;
    return {
      key: fileKey,
      url: this.getPublicUrl(fileKey),
      contentType: "application/octet-stream",
      size: uploaded.size ?? body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        path: key.startsWith("id:")
          ? key
          : `${this.normalizeFolder(this.config.folderId)}/${key.split("/").pop() ?? key}`,
      }),
    });
    if (!response.ok) throw new Error("Dropbox deletion failed");
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
        "https://api.dropboxapi.com/2/files/get_metadata",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            path: this.normalizeFolder(this.config.folderId),
          }),
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
        details: error instanceof Error ? error.message : "Dropbox unavailable",
      };
    }
  }

  private normalizeFolder(folderId: string): string {
    const trimmed = folderId.trim().replace(/\/+$/, "");
    if (!trimmed || trimmed === "/") return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.credentials.expiresAt > Date.now() + 60_000) {
      return this.credentials.accessToken;
    }
    const env = getServerEnv();
    if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET) {
      throw new Error("Dropbox OAuth credentials are not configured");
    }
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${env.DROPBOX_APP_KEY}:${env.DROPBOX_APP_SECRET}`).toString(
            "base64",
          ),
      },
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refreshToken,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!response.ok || !body?.access_token) {
      throw new Error("Dropbox OAuth token refresh failed");
    }
    this.credentials.accessToken = body.access_token;
    this.credentials.expiresAt =
      Date.now() + (body.expires_in ?? 3600) * 1000;
    return body.access_token;
  }
}
