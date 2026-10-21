import "server-only";
import { randomUUID } from "node:crypto";
import type { PlatformStore } from "@/core/ports/platform-store";
import type { SecretVault } from "@/core/ports/secret-vault";
import {
  decryptSecret,
  EncryptedSecretSchema,
  encryptSecret,
} from "@/lib/server/crypto";

export class EncryptedSecretVault implements SecretVault {
  constructor(private readonly store: PlatformStore) {}

  async putSecret(input: {
    tenantId?: string;
    name: string;
    value: string;
  }): Promise<string> {
    const ref = randomUUID();
    await this.store.putSecretRecord({
      ref,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      name: input.name,
      encryptedValue: JSON.stringify(encryptSecret(input.value)),
      createdAt: new Date().toISOString(),
    });
    return ref;
  }

  async getSecret(secretRef: string): Promise<string> {
    const record = await this.store.getSecretRecord(secretRef);
    if (!record) {
      throw new Error(`Secret reference "${secretRef}" was not found`);
    }

    return decryptSecret(
      EncryptedSecretSchema.parse(JSON.parse(record.encryptedValue)),
    );
  }

  async deleteSecret(secretRef: string): Promise<void> {
    await this.store.deleteSecretRecord(secretRef);
  }
}
