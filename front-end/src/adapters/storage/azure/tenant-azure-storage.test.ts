import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantAzureStorageAdapter } from "./tenant-azure-storage";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const otherTenantId = "550e8400-e29b-41d4-a716-446655440099";
const config = {
  type: "azure" as const,
  accountName: "tenantassets",
  container: "tenant-assets",
  publicBaseUrl:
    "https://tenantassets.blob.core.windows.net/tenant-assets",
  credentialsRef: "secret-ref",
};
const credentials = {
  accountName: "tenantassets",
  accountKey: Buffer.from("test-account-key").toString("base64"),
};

function streamOf(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("TenantAzureStorageAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tenant-scoped keys and uploads verified content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 201 }),
      ),
    );
    const adapter = new TenantAzureStorageAdapter(
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
      url: `https://tenantassets.blob.core.windows.net/tenant-assets/${target.key}`,
      contentType: "image/png",
      size: bytes.byteLength,
    });
  });

  it("rejects cross-tenant operations and invalid content", async () => {
    const adapter = new TenantAzureStorageAdapter(
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

  it("encodes public URLs and reports container health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<EnumerationResults />", { status: 200 })),
    );
    const adapter = new TenantAzureStorageAdapter(
      config,
      tenantId,
      credentials,
    );
    const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.webp`;
    expect(adapter.getPublicUrl(key)).toBe(
      `https://tenantassets.blob.core.windows.net/tenant-assets/${key}`,
    );
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
