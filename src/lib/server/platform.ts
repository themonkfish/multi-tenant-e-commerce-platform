import "server-only";
import { createPlatformStore } from "@/adapters/platform/factory";
import { EncryptedSecretVault } from "@/adapters/platform/file/secret-vault";

let platformStore: ReturnType<typeof createPlatformStore> | undefined;
let secretVault: EncryptedSecretVault | undefined;

export function getPlatformStore() {
  platformStore ??= createPlatformStore();
  return platformStore;
}

export function getSecretVault() {
  secretVault ??= new EncryptedSecretVault(getPlatformStore());
  return secretVault;
}
