import "server-only";
import { createPlatformStore } from "@/adapters/platform/factory";
import { EncryptedSecretVault } from "@/adapters/platform/file/secret-vault";

export function getPlatformStore() {
  return createPlatformStore();
}

export function getSecretVault() {
  return new EncryptedSecretVault(getPlatformStore());
}
