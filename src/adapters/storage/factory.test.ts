import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@/core/ports/storage";
import { createStorageAdapterFactory } from "./factory";

const storageAdapter: StoragePort = {
  capabilities: {
    presignedUploads: true,
    publicCdn: true,
    imageTransforms: false,
    oauth: false,
  },
  prepareUpload: vi.fn(),
  getPublicUrl: vi.fn(),
  delete: vi.fn(),
  healthCheck: vi.fn(),
};

describe("createStorageAdapterFactory", () => {
  it("returns an adapter registered for the selected provider", () => {
    const factory = createStorageAdapterFactory({ s3: storageAdapter });

    expect(
      factory({
        type: "s3",
        region: "us-east-1",
        bucket: "assets",
        credentialsRef: "secret-ref",
        publicBaseUrl: "https://cdn.example",
      }),
    ).toBe(storageAdapter);
  });

  it("fails explicitly when a provider is not registered", () => {
    const factory = createStorageAdapterFactory({});

    expect(() =>
      factory({
        type: "gcs",
        bucket: "assets",
        credentialsRef: "secret-ref",
        publicBaseUrl: "https://cdn.example",
      }),
    ).toThrow('Storage adapter "gcs" is not configured');
  });
});
