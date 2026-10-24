import { describe, expect, it } from "vitest";
import { verifyTenantDomainDns } from "./tenant-domain-verification";

describe("verifyTenantDomainDns", () => {
  it("requires the platform CNAME and the exact TXT challenge", async () => {
    const resolver = {
      resolveCname: async () => ["platform.example.com."],
      resolveTxt: async () => [["platform-verification=challenge-token"]],
    };

    await expect(
      verifyTenantDomainDns(
        "store.example.net",
        "platform.example.com",
        "challenge-token",
        resolver,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyTenantDomainDns(
        "store.example.net",
        "platform.example.com",
        "different-token",
        resolver,
      ),
    ).resolves.toBe(false);
  });

  it("returns false when either required DNS record is absent", async () => {
    const resolver = {
      resolveCname: async () => {
        const error = new Error("record not found") as NodeJS.ErrnoException;
        error.code = "ENODATA";
        throw error;
      },
      resolveTxt: async () => [["platform-verification=challenge-token"]],
    };

    await expect(
      verifyTenantDomainDns(
        "store.example.net",
        "platform.example.com",
        "challenge-token",
        resolver,
      ),
    ).resolves.toBe(false);
  });
});
