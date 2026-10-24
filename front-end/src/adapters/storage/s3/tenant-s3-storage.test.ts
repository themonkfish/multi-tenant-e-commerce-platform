import { describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor() {}
    send(command: unknown) {
      return sendMock(command);
    }
  }
  return {
    S3Client,
    PutObjectCommand: class PutObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    HeadBucketCommand: class HeadBucketCommand extends Command {},
  };
});

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: class NodeHttpHandler {
    constructor() {}
  },
}));

import { TenantS3StorageAdapter } from "./tenant-s3-storage";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const otherTenantId = "550e8400-e29b-41d4-a716-446655440099";
const config = {
  type: "s3" as const,
  region: "ap-south-1",
  bucket: "tenant-assets",
  publicBaseUrl: "https://cdn.example.com/assets",
  pathStyle: false,
  credentialsRef: "secret-ref",
};
const credentials = {
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
};

function streamOf(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("TenantS3StorageAdapter", () => {
  it("creates tenant-scoped keys and uploads verified content", async () => {
    sendMock.mockResolvedValue({});
    const adapter = new TenantS3StorageAdapter(config, tenantId, credentials);
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
      url: `https://cdn.example.com/assets/${target.key}`,
      contentType: "image/png",
      size: bytes.byteLength,
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: config.bucket,
          Key: target.key,
          ContentType: "image/png",
          ContentLength: bytes.byteLength,
        }),
      }),
    );
  });

  it("rejects cross-tenant files, spoofed content, and cross-tenant deletes", async () => {
    const adapter = new TenantS3StorageAdapter(config, tenantId, credentials);
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
    await expect(
      adapter.delete(
        `${otherTenantId}/550e8400-e29b-41d4-a716-446655440001.png`,
      ),
    ).rejects.toThrow("outside this tenant");
  });

  it("encodes valid tenant keys into the public URL and checks bucket access", async () => {
    sendMock.mockResolvedValue({});
    const adapter = new TenantS3StorageAdapter(config, tenantId, credentials);
    const key = `${tenantId}/550e8400-e29b-41d4-a716-446655440001.webp`;
    expect(adapter.getPublicUrl(key)).toBe(
      `https://cdn.example.com/assets/${key}`,
    );
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
