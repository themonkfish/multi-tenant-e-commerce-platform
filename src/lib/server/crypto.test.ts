import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const originalKey = process.env.PLATFORM_SECRET_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.PLATFORM_SECRET_KEY;
  } else {
    process.env.PLATFORM_SECRET_KEY = originalKey;
  }
});

describe("secret encryption", () => {
  it("round-trips plaintext using authenticated encryption", () => {
    process.env.PLATFORM_SECRET_KEY = "ab".repeat(32);
    const encrypted = encryptSecret("integration-secret");

    expect(encrypted.ciphertext).not.toBe("integration-secret");
    expect(decryptSecret(encrypted)).toBe("integration-secret");
  });

  it("rejects encrypted values changed after storage", () => {
    process.env.PLATFORM_SECRET_KEY = "cd".repeat(32);
    const encrypted = encryptSecret("private-value");

    expect(() =>
      decryptSecret({
        ...encrypted,
        ciphertext: Buffer.from("tampered").toString("base64"),
      }),
    ).toThrow();
  });

  it("rejects encryption keys with the wrong length", () => {
    process.env.PLATFORM_SECRET_KEY = "too-short";

    expect(() => encryptSecret("private-value")).toThrow(
      "PLATFORM_SECRET_KEY must encode exactly 32 bytes",
    );
  });
});
