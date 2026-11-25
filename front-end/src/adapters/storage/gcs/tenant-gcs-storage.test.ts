import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantGcsStorageAdapter } from "./tenant-gcs-storage";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const otherTenantId = "550e8400-e29b-41d4-a716-446655440099";
const config = {
  type: "gcs" as const,
  bucket: "tenant-assets",
  publicBaseUrl: "https://cdn.example.com/assets",
  credentialsRef: "secret-ref",
};
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = {
  client_email: "tenant@example.iam.gserviceaccount.com",
  private_key: privateKey,
};

function streamOf(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("TenantGcsStorageAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tenant-scoped keys and uploads verified content", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ name: "uploaded" }), { status: 200 }),
        ),
    );
    const adapter = new TenantGcsStorageAdapter(
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

    await expect(
      adapter.upload(target.key, streamOf(bytes), meta),
    ).resolves.toEqual({
      key: target.key,
      url: `https://cdn.example.com/assets/${target.key}`,
      contentType: "image/png",
      size: bytes.byteLength,
    });
  });

  it("rejects cross-tenant and invalid image operations", async () => {
    const adapter = new TenantGcsStorageAdapter(
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

  it("encodes public URLs and reports bucket health", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [] }), { status: 200 }),
        ),
    );
    const adapter = new TenantGcsStorageAdapter(
      config,
      tenantId,
      credentials,
    );
    const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.webp`;
    expect(adapter.getPublicUrl(key)).toBe(
      `https://cdn.example.com/assets/${key}`,
    );
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
