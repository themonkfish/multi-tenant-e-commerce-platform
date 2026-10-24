import { beforeEach, describe, expect, it, vi } from "vitest";

const { httpsRequestMock, resolvePublicAddressMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  resolvePublicAddressMock: vi.fn(),
}));

vi.mock("node:https", () => ({ request: httpsRequestMock }));
vi.mock("@/adapters/data/rest/health-check", () => ({
  resolvePublicAddress: resolvePublicAddressMock,
}));

import { checkTenantDomainReadiness } from "./tenant-domain-readiness";

describe("checkTenantDomainReadiness", () => {
  beforeEach(() => {
    httpsRequestMock.mockReset();
    resolvePublicAddressMock.mockReset();
  });

  it("blocks private or otherwise non-public DNS destinations before HTTPS", async () => {
    resolvePublicAddressMock.mockResolvedValue(null);

    await expect(
      checkTenantDomainReadiness("shop.example.com"),
    ).resolves.toEqual({ status: "blocked_target" });
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("reports DNS resolution failures without attempting HTTPS", async () => {
    resolvePublicAddressMock.mockRejectedValue(new Error("DNS failed"));

    await expect(
      checkTenantDomainReadiness("shop.example.com"),
    ).resolves.toEqual({ status: "unreachable" });
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});
