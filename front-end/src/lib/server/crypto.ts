import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "./env";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export const EncryptedSecretSchema = z.object({
  version: z.literal(1),
  iv: z.base64(),
  ciphertext: z.base64(),
  authTag: z.base64(),
});

export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

function getEncryptionKey(): Buffer {
  const secret = getServerEnv().PLATFORM_SECRET_KEY;

  if (!secret) {
    throw new Error("PLATFORM_SECRET_KEY is required to encrypt secrets");
  }

  const key = /^[\da-f]{64}$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : Buffer.from(secret, "base64");

  if (key.length !== 32) {
    throw new Error(
      "PLATFORM_SECRET_KEY must encode exactly 32 bytes as 64 hex or 44 base64 characters",
    );
  }

  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  const parsed = EncryptedSecretSchema.parse(encrypted);

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}
