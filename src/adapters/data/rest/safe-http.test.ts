import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import type { TenantRestDataProviderConfig } from "@/core/domain/tenant-config";
import { requestSafeRestBackend, buildRequestUrl } from "./safe-http";

const config: TenantRestDataProviderConfig = {
  type: "rest",
  baseUrl: "https://api.example.com",
  apiVersion: "v1",
  authMode: "apiKey",
  apiKeyRef: "secret-ref",
};

describe("safe REST backend transport", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("builds requests under the configured version and encodes query values", () => {
    const url = buildRequestUrl(
      config,
      "/products",
      new URLSearchParams({ page: "1", tenantId: "tenant/one" }),
    );

    expect(url.toString()).toBe(
      "https://api.example.com/v1/products?page=1&tenantId=tenant%2Fone",
    );
  });

  it("rejects private or mixed public/private DNS answers before connecting", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);

    await expect(
      requestSafeRestBackend(config, "secret", {
        method: "GET",
        path: "/products",
      }),
    ).rejects.toThrow("non-public IP address");
  });

  it("rejects paths that could escape the tenant API endpoint", () => {
    expect(() => buildRequestUrl(config, "/products/../secrets")).toThrow(
      "Invalid REST backend path",
    );
    expect(() => buildRequestUrl(config, "//other.example/path")).toThrow(
      "Invalid REST backend path",
    );
  });
});
