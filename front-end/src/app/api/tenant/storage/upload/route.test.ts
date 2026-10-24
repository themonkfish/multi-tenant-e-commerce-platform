import { afterEach, describe, expect, it, vi } from "vitest";

const { getTenantPortalSession, getPlatformStore, createTenantStorageAdapter } =
  vi.hoisted(() => ({
    getTenantPortalSession: vi.fn(),
    getPlatformStore: vi.fn(),
    createTenantStorageAdapter: vi.fn(),
  }));

vi.mock("@/lib/server/session", () => ({ getTenantPortalSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));
vi.mock("@/adapters/storage/tenant-storage-provider", () => ({
  createTenantStorageAdapter,
}));

import { POST } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const userId = "550e8400-e29b-41d4-a716-446655440020";
const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function uploadRequest(data: Uint8Array, contentType = "image/png") {
  const form = new FormData();
  const fileBytes = new ArrayBuffer(data.byteLength);
  new Uint8Array(fileBytes).set(data);
  form.set(
    "file",
    new File([fileBytes], "catalog-image.png", { type: contentType }),
  );
  return new Request("http://store.localhost:3000/api/tenant/storage/upload", {
    method: "POST",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
    },
    body: form,
  });
}

describe("POST /api/tenant/storage/upload", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires catalog write permission", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId,
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["catalog:read"],
    });

    const response = await POST(uploadRequest(pngHeader));

    expect(response.status).toBe(403);
    expect(createTenantStorageAdapter).not.toHaveBeenCalled();
  });

  it("validates file bytes and proxies accepted images to tenant-scoped storage", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId,
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["catalog:read", "catalog:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });
    const upload = vi.fn().mockResolvedValue({
      key: `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`,
      url: "https://cdn.example.com/image.png",
      contentType: "image/png",
      size: pngHeader.byteLength,
    });
    createTenantStorageAdapter.mockResolvedValue({
      prepareUpload: vi.fn().mockResolvedValue({
        mode: "server-proxy",
        key: `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`,
      }),
      upload,
    });

    const response = await POST(uploadRequest(pngHeader));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      file: { contentType: "image/png", size: pngHeader.byteLength },
    });
    expect(createTenantStorageAdapter).toHaveBeenCalledWith(tenantId, hostId);
    expect(upload).toHaveBeenCalledWith(
      `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`,
      expect.any(ReadableStream),
      expect.objectContaining({ tenantId, contentType: "image/png" }),
    );
  });

  it("rejects spoofed image content before reaching the configured provider", async () => {
    getTenantPortalSession.mockResolvedValue({
      userId,
      role: "tenant_staff",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["catalog:read", "catalog:write"],
    });
    getPlatformStore.mockReturnValue({
      consumeRateLimit: vi.fn().mockResolvedValue(true),
    });

    const response = await POST(
      uploadRequest(Buffer.from("<svg></svg>"), "image/png"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "unsupported_or_invalid_image",
    });
    expect(createTenantStorageAdapter).not.toHaveBeenCalled();
  });
});
