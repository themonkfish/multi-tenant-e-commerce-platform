import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantGoogleDriveStorageAdapter } from "./tenant-gdrive-storage";

describe("TenantGoogleDriveStorageAdapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports OAuth and server-proxy capabilities", () => {
    const adapter = new TenantGoogleDriveStorageAdapter(
      {
        type: "gdrive",
        folderId: "folder-123",
        oauthTokenRef: "secret-ref",
        accountEmail: "owner@example.com",
      },
      "550e8400-e29b-41d4-a716-446655440000",
      {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 300_000,
      },
    );
    expect(adapter.capabilities).toMatchObject({
      oauth: true,
      presignedUploads: false,
      publicCdn: false,
    });
  });

  it("validates tenant scope before preparing an upload", async () => {
    const adapter = new TenantGoogleDriveStorageAdapter(
      {
        type: "gdrive",
        folderId: "folder-123",
        oauthTokenRef: "secret-ref",
        accountEmail: "owner@example.com",
      },
      "550e8400-e29b-41d4-a716-446655440000",
      {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 300_000,
      },
    );
    await expect(
      adapter.prepareUpload({
        tenantId: "another-tenant",
        fileName: "photo.jpg",
        contentType: "image/jpeg",
        size: 100,
      }),
    ).rejects.toThrow("does not match");
  });
});
