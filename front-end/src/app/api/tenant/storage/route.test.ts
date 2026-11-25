import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getTenantOwnerSession,
  getPlatformStore,
  getSecretVault,
  resolvePublicAddress,
} = vi.hoisted(() => ({
  getTenantOwnerSession: vi.fn(),
  getPlatformStore: vi.fn(),
  getSecretVault: vi.fn(),
  resolvePublicAddress: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getTenantOwnerSession }));
vi.mock("@/lib/server/platform", () => ({ getPlatformStore, getSecretVault }));
vi.mock("@/adapters/data/rest/health-check", () => ({ resolvePublicAddress }));

import { PUT } from "./route";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";
const hostId = "550e8400-e29b-41d4-a716-446655440010";
const ownerId = "550e8400-e29b-41d4-a716-446655440020";
const credentialsRef = "550e8400-e29b-41d4-a716-446655440030";

function saveRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://store.localhost:3000/api/tenant/storage", {
    method: "PUT",
    headers: {
      host: "store.localhost:3000",
      origin: "http://store.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "s3",
      endpoint: "https://s3.example.com",
      region: "auto",
      bucket: "tenant-assets",
      publicBaseUrl: "https://cdn.example.com/assets",
      pathStyle: true,
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      ...overrides,
    }),
  });
}

describe("PUT /api/tenant/storage", () => {
  afterEach(() => vi.clearAllMocks());

  it("stores credentials in the encrypted vault and returns only safe configuration", async () => {
    const config = {
      type: "s3" as const,
      endpoint: "https://s3.example.com",
      region: "auto",
      bucket: "tenant-assets",
      publicBaseUrl: "https://cdn.example.com/assets",
      pathStyle: true,
      credentialsRef,
    };
    const store = {
      getTenantStorageProvider: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateTenantStorageProvider: vi.fn().mockResolvedValue(config),
    };
    const vault = { putSecret: vi.fn().mockResolvedValue(credentialsRef) };
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue(store);
    getSecretVault.mockReturnValue(vault);
    resolvePublicAddress.mockResolvedValue({
      address: "203.0.113.1",
      family: 4,
    });

    const response = await PUT(saveRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection).toMatchObject({
      type: "s3",
      bucket: "tenant-assets",
      credentialsConfigured: true,
    });
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(vault.putSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        name: "tenant-s3-storage-credentials",
        value: JSON.stringify({
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        }),
      }),
    );
    expect(store.updateTenantStorageProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        hostId,
        config,
      }),
    );
  });

  it("rejects storage URLs that resolve to private networks", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    resolvePublicAddress.mockResolvedValue(null);

    const response = await PUT(saveRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsafe_storage_url" });
    expect(getPlatformStore).not.toHaveBeenCalled();
  });

  it("rejects partial credential rotation", async () => {
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    resolvePublicAddress.mockResolvedValue({
      address: "203.0.113.1",
      family: 4,
    });

    const response = await PUT(
      saveRequest({
        secretAccessKey: undefined,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: "invalid_input" }),
    );
    expect(getPlatformStore).not.toHaveBeenCalled();
  });

  it("stores Cloudinary account settings and credentials in the vault", async () => {
    const cloudinaryConfig = {
      type: "cloudinary" as const,
      cloudName: "tenant-cloud",
      credentialsRef,
    };
    const store = {
      getTenantStorageProvider: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateTenantStorageProvider: vi
        .fn()
        .mockResolvedValue(cloudinaryConfig),
    };
    const vault = { putSecret: vi.fn().mockResolvedValue(credentialsRef) };
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue(store);
    getSecretVault.mockReturnValue(vault);
    resolvePublicAddress.mockResolvedValue({
      address: "203.0.113.1",
      family: 4,
    });

    const response = await PUT(
      saveRequest({
        type: "cloudinary",
        endpoint: undefined,
        region: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        cloudName: "tenant-cloud",
        apiKey: "123456789",
        apiSecret: "test-api-secret",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connection: {
        type: "cloudinary",
        cloudName: "tenant-cloud",
        credentialsConfigured: true,
      },
    });
    expect(vault.putSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tenant-cloudinary-storage-credentials",
      }),
    );
  });

  it("stores Azure account settings and an account key in the vault", async () => {
    const azureConfig = {
      type: "azure" as const,
      accountName: "tenantassets",
      container: "tenant-assets",
      publicBaseUrl:
        "https://tenantassets.blob.core.windows.net/tenant-assets",
      credentialsRef,
    };
    const store = {
      getTenantStorageProvider: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateTenantStorageProvider: vi.fn().mockResolvedValue(azureConfig),
    };
    const vault = { putSecret: vi.fn().mockResolvedValue(credentialsRef) };
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue(store);
    getSecretVault.mockReturnValue(vault);
    resolvePublicAddress.mockResolvedValue({
      address: "203.0.113.1",
      family: 4,
    });

    const response = await PUT(
      saveRequest({
        type: "azure",
        endpoint: undefined,
        region: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        accountName: "tenantassets",
        container: "tenant-assets",
        publicBaseUrl:
          "https://tenantassets.blob.core.windows.net/tenant-assets",
        accountKey: Buffer.from("test-account-key").toString("base64"),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connection: {
        type: "azure",
        accountName: "tenantassets",
        container: "tenant-assets",
        credentialsConfigured: true,
      },
    });
    expect(vault.putSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tenant-azure-storage-account-key",
      }),
    );
  });

  it("stores GCS bucket settings and a service account in the vault", async () => {
    const gcsConfig = {
      type: "gcs" as const,
      bucket: "tenant-assets",
      publicBaseUrl: "https://storage.googleapis.com/tenant-assets",
      credentialsRef,
    };
    const store = {
      getTenantStorageProvider: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockResolvedValue(true),
      updateTenantStorageProvider: vi.fn().mockResolvedValue(gcsConfig),
    };
    const vault = { putSecret: vi.fn().mockResolvedValue(credentialsRef) };
    getTenantOwnerSession.mockResolvedValue({
      userId: ownerId,
      role: "tenant_owner",
      scope: { kind: "tenant", id: tenantId, hostId },
      permissions: ["tenant:read", "tenant:write"],
    });
    getPlatformStore.mockReturnValue(store);
    getSecretVault.mockReturnValue(vault);
    resolvePublicAddress.mockResolvedValue({
      address: "203.0.113.1",
      family: 4,
    });

    const response = await PUT(
      saveRequest({
        type: "gcs",
        endpoint: undefined,
        region: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        publicBaseUrl: "https://storage.googleapis.com/tenant-assets",
        serviceAccountJson: JSON.stringify({
          client_email: "tenant@example.iam.gserviceaccount.com",
          private_key: "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connection: {
        type: "gcs",
        bucket: "tenant-assets",
        credentialsConfigured: true,
      },
    });
    expect(vault.putSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tenant-gcs-storage-service-account",
      }),
    );
  });
});
