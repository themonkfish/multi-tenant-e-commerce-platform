import { describe, expect, it } from "vitest";
import { TenantOneDriveStorageAdapter } from "./tenant-onedrive-storage";

describe("TenantOneDriveStorageAdapter", () => {
  it("reports OAuth server-proxy capabilities", () => {
    const adapter = new TenantOneDriveStorageAdapter(
      {
        type: "onedrive",
        folderId: "/TenantAssets",
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

  it("rejects upload scopes outside the tenant", async () => {
    const adapter = new TenantOneDriveStorageAdapter(
      {
        type: "onedrive",
        folderId: "/TenantAssets",
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
        tenantId: "other-tenant",
        fileName: "photo.jpg",
        contentType: "image/jpeg",
        size: 100,
      }),
    ).rejects.toThrow("does not match");
  });
});
