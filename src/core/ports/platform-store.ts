import type { AccessScope } from "@/core/tenancy/scope";

export type PlatformSetupState = {
  initialized: boolean;
  platformDomain?: string;
  reservedSubdomains: string[];
};

export type SuperAdminRecord = {
  id: string;
  email: string;
  passwordHash: string;
  totpSecretCiphertext: string;
  recoveryCodeHashes: string[];
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  actorId: string;
  scope: AccessScope;
  action: string;
  resourceType: string;
  resourceId?: string;
  createdAt: string;
};

export type BootstrapInput = {
  setupTokenHash: string;
  platformDomain: string;
  reservedSubdomains: string[];
  superAdmin: SuperAdminRecord;
};

export type SecretRecord = {
  ref: string;
  tenantId?: string;
  name: string;
  encryptedValue: string;
  createdAt: string;
};

export interface PlatformStore {
  getSetupState(): Promise<PlatformSetupState>;
  getBootstrapAdmin(
    setupTokenHash: string,
    email: string,
  ): Promise<SuperAdminRecord | null>;
  createInitialSuperAdmin(input: BootstrapInput): Promise<void>;
  getSuperAdminByEmail(email: string): Promise<SuperAdminRecord | null>;
  consumeRecoveryCode(adminId: string, codeHash: string): Promise<boolean>;
  completeBootstrap(input: {
    setupTokenHash: string;
    email: string;
    recoveryCodeHashes: string[];
    auditEvent: AuditEvent;
  }): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<void>;
  putSecretRecord(record: SecretRecord): Promise<void>;
  getSecretRecord(ref: string): Promise<SecretRecord | null>;
  deleteSecretRecord(ref: string): Promise<void>;
  consumeRateLimit(input: {
    key: string;
    limit: number;
    windowMs: number;
    now: number;
  }): Promise<boolean>;
}
