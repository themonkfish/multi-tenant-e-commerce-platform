import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantCloudinaryStorageAdapter } from "./tenant-cloudinary-storage";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const otherTenantId = "550e8400-e29b-41d4-a716-446655440099";
const config = {
  type: "cloudinary" as const,
  cloudName: "tenant-cloud",
  credentialsRef: "secret-ref",
};
const credentials = {
  apiKey: "123456789",
  apiSecret: "test-api-secret",
};

function streamOf(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("TenantCloudinaryStorageAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tenant-scoped public IDs and uploads verified content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ public_id: "uploaded" }), { status: 200 }),
      ),
    );
    const adapter = new TenantCloudinaryStorageAdapter(
      config,
      tenantId,
      credentials,
    );
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const meta = {
      tenantId,
      fileName: "image.png",
      contentType: "image/png",
      size: bytes.byteLength,
    };
    const target = await adapter.prepareUpload(meta);
    expect(target.mode).toBe("server-proxy");
    if (target.mode !== "server-proxy")
      throw new Error("Expected proxy upload");
    expect(target.key).toMatch(
      new RegExp(`^${tenantId}/[0-9a-f-]{36}\\.png$`, "i"),
    );

    await expect(
      adapter.upload(target.key, streamOf(bytes), meta),
    ).resolves.toEqual({
      key: target.key,
      url: `https://res.cloudinary.com/tenant-cloud/image/upload/${tenantId}/${target.key.split("/")[1].replace(/\.png$/, "")}`,
      contentType: "image/png",
      size: bytes.byteLength,
    });
  });

  it("rejects cross-tenant operations and invalid content", async () => {
    const adapter = new TenantCloudinaryStorageAdapter(
      config,
      tenantId,
      credentials,
    );
    await expect(
      adapter.prepareUpload({
        tenantId: otherTenantId,
        fileName: "image.png",
        contentType: "image/png",
        size: 8,
      }),
    ).rejects.toThrow("configured tenant scope");
    await expect(
      adapter.upload(
        `${tenantId}/550e8400-e29b-41d4-a716-446655440001.png`,
        streamOf(Buffer.from("<svg></svg>")),
        {
          tenantId,
          fileName: "image.png",
          contentType: "image/png",
          size: Buffer.byteLength("<svg></svg>"),
        },
      ),
    ).rejects.toThrow("does not match");
  });

  it("generates transformed public URLs and reports account health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ resources: [] }), { status: 200 }),
      ),
    );
    const adapter = new TenantCloudinaryStorageAdapter(
      config,
      tenantId,
      credentials,
    );
    const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.webp`;
    expect(adapter.getPublicUrl(key)).toBe(
      `https://res.cloudinary.com/tenant-cloud/image/upload/${tenantId}/550e8400-e29b-41d4-a716-446655440001`,
    );
    expect(adapter.getPublicUrl(key, { width: 640, format: "webp" })).toBe(
      `https://res.cloudinary.com/tenant-cloud/image/upload/w_640,c_limit,f_webp/${tenantId}/550e8400-e29b-41d4-a716-446655440001`,
    );
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
