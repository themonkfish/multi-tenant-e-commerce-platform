import "server-only";
import type {
  FileMeta,
  StoredFile,
  StoragePort,
  UploadTarget,
} from "@/core/ports/storage";
import { getServerEnv } from "@/lib/server/env";

type OneDriveCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class TenantOneDriveStorageAdapter implements StoragePort {
  capabilities = {
    presignedUploads: false,
    publicCdn: false,
    imageTransforms: false,
    oauth: true,
  } as const;

  constructor(
    private readonly config: {
      type: "onedrive";
      folderId: string;
      oauthTokenRef: string;
      accountEmail: string;
    },
    private readonly tenantId: string,
    private readonly credentials: OneDriveCredentials,
  ) {}

  async prepareUpload(file: FileMeta): Promise<UploadTarget> {
    if (file.tenantId !== this.tenantId) {
      throw new Error("OneDrive upload scope does not match the tenant");
    }
    return {
      mode: "server-proxy",
      key: `tenants/${this.tenantId}/${crypto.randomUUID()}-${file.fileName}`,
    };
  }

  getPublicUrl(key: string): string {
    return `https://onedrive.live.com/view.aspx?resid=${encodeURIComponent(key)}`;
  }

  async upload(
    key: string,
    data: ReadableStream<Uint8Array>,
  ): Promise<StoredFile> {
    const token = await this.getAccessToken();
    const body = await new Response(data).arrayBuffer();
    const folder = this.normalizeFolder(this.config.folderId);
    const fileName = key.split("/").pop() ?? key;
    const path = `${folder}/${encodeURIComponent(fileName)}`.replace(
      /\/+/g,
      "/",
    );
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:${path}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        signal: AbortSignal.timeout(30_000),
        body,
      },
    );
    if (!response.ok) throw new Error("OneDrive upload failed");
    const uploaded = (await response.json()) as {
      id?: string;
      name?: string;
      size?: number;
      webUrl?: string;
    };
    const fileKey = uploaded.id ?? path;
    return {
      key: fileKey,
      url: uploaded.webUrl ?? this.getPublicUrl(fileKey),
      contentType: "application/octet-stream",
      size: uploaded.size ?? body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const token = await this.getAccessToken();
    const path =
      key.startsWith("!") || key.startsWith("item:")
        ? `/me/drive/items/${encodeURIComponent(key)}`
        : `/me/drive/root:${this.normalizeFolder(this.config.folderId)}/${encodeURIComponent(key.split("/").pop() ?? key)}:/`;
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("OneDrive deletion failed");
  }

  async healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }> {
    const startedAt = Date.now();
    try {
      const token = await this.getAccessToken();
      const folder = this.normalizeFolder(this.config.folderId);
      const path = folder
        ? `/me/drive/root:${folder}`
        : "/me/drive/root";
      const response = await fetch(
        `https://graph.microsoft.com/v1.0${path}?$select=id,name,folder`,
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
        details: error instanceof Error ? error.message : "OneDrive unavailable",
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
    if (!env.ONEDRIVE_CLIENT_ID || !env.ONEDRIVE_CLIENT_SECRET) {
      throw new Error("OneDrive OAuth credentials are not configured");
    }
    const tenantId = env.ONEDRIVE_TENANT_ID ?? "common";
    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          client_id: env.ONEDRIVE_CLIENT_ID,
          client_secret: env.ONEDRIVE_CLIENT_SECRET,
          refresh_token: this.credentials.refreshToken,
          grant_type: "refresh_token",
          scope: "offline_access Files.ReadWrite",
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!response.ok || !body?.access_token) {
      throw new Error("OneDrive OAuth token refresh failed");
    }
    this.credentials.accessToken = body.access_token;
    this.credentials.expiresAt =
      Date.now() + (body.expires_in ?? 3600) * 1000;
    return body.access_token;
  }
}
