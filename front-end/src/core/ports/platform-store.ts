import type { AccessScope } from "@/core/tenancy/scope";
import type { HostConfig, HostStatus } from "@/core/domain/host-config";
import type {
  HostOwner,
  HostOwnerInvite,
  TenantOwner,
  TenantOwnerInvite,
  TenantDomainClaim,
  TenantRecord,
  TenantStoreSettings,
  TenantStatus,
} from "@/core/domain/host-portal";
import type { TenantRestDataProviderConfig } from "@/core/domain/tenant-config";
import type {
  CustomerAccount,
  CustomerOrder,
  TenantStaff,
  TenantStaffPermission,
} from "@/core/domain/tenant-identities";
import type {
  HostConfigurationStore,
  TenantConfigurationStore,
} from "@/core/ports/configuration-store";

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

export interface PlatformStore
  extends HostConfigurationStore, TenantConfigurationStore {
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
  listHosts(): Promise<HostConfig[]>;
  createHost(host: HostConfig, auditEvent: AuditEvent): Promise<void>;
  updateHostStatus(
    id: string,
    status: HostStatus,
    updatedAt: string,
    auditEvent: AuditEvent,
  ): Promise<HostConfig | null>;
  createHostOwnerInvite(
    invite: HostOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void>;
  getHostOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<HostOwnerInvite | null>;
  acceptHostOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<HostOwner | null>;
  getHostOwnerByEmail(email: string): Promise<HostOwner | null>;
  createTenantOwnerInvite(
    invite: TenantOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void>;
  getTenantOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<TenantOwnerInvite | null>;
  acceptTenantOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<TenantOwner | null>;
  getTenantOwnerByEmail(email: string): Promise<TenantOwner | null>;
  getTenantOwnerByTenant(tenantId: string): Promise<TenantOwner | null>;
  getTenantOwnerForTenant(
    ownerId: string,
    tenantId: string,
  ): Promise<TenantOwner | null>;
  listTenantStaff(
    tenantId: string,
  ): Promise<Omit<TenantStaff, "passwordHash">[]>;
  createTenantStaff(input: {
    id: string;
    tenantId: string;
    hostId: string;
    email: string;
    passwordHash: string;
    permissions: TenantStaffPermission[];
    createdAt: string;
  }): Promise<TenantStaff>;
  updateTenantStaff(input: {
    staffId: string;
    tenantId: string;
    active?: boolean;
    passwordHash?: string;
  }): Promise<TenantStaff | null>;
  getTenantStaffByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantStaff | null>;
  getTenantStaffForTenant(
    staffId: string,
    tenantId: string,
  ): Promise<TenantStaff | null>;
  getCustomerAccountByEmail(
    tenantId: string,
    email: string,
  ): Promise<CustomerAccount | null>;
  getCustomerAccountForTenant(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAccount | null>;
  createCustomerAccount(input: {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    createdAt: string;
  }): Promise<CustomerAccount>;
  createCustomerOrder(
    order: CustomerOrder,
  ): Promise<{ order: CustomerOrder; created: boolean }>;
  getCustomerOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
  ): Promise<CustomerOrder | null>;
  prepareCustomerOrderPayment(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
  }): Promise<{ order: CustomerOrder; attempt: number } | null>;
  saveCustomerOrderPaymentSession(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    attempt: number;
    sessionId: string;
  }): Promise<CustomerOrder | null>;
  updateCustomerOrderPayment(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    sessionId: string;
    status: CustomerOrder["paymentStatus"];
    paymentIntentId?: string;
  }): Promise<CustomerOrder | null>;
  updateCustomerOrderSync(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    status: CustomerOrder["backendSyncStatus"];
    error?: string;
  }): Promise<CustomerOrder | null>;
  updateCustomerOrderStatus(input: {
    tenantId: string;
    orderId: string;
    status: CustomerOrder["status"];
  }): Promise<CustomerOrder | null>;
  listCustomerOrders(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerOrder[]>;
  getTenantStoreSettings(
    tenantId: string,
    hostId: string,
    tenantName: string,
  ): Promise<TenantStoreSettings>;
  updateTenantStoreSettings(input: {
    tenantId: string;
    hostId: string;
    settings: TenantStoreSettings;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantStoreSettings | null>;
  getTenantRestConnection(
    tenantId: string,
    hostId: string,
  ): Promise<TenantRestDataProviderConfig | null>;
  updateTenantRestConnection(input: {
    tenantId: string;
    hostId: string;
    config: TenantRestDataProviderConfig;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRestDataProviderConfig | null>;
  listTenantsForHost(hostId: string): Promise<TenantRecord[]>;
  listTenantDomainClaims(hostId: string): Promise<TenantDomainClaim[]>;
  createTenantDomainClaim(input: {
    hostId: string;
    tenantId: string;
    domain: string;
    verificationToken: string;
    createdAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantDomainClaim | null>;
  completeTenantDomainClaim(input: {
    hostId: string;
    tenantId: string;
    domain: string;
    verificationToken: string;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRecord | null>;
  createTenantForHost(
    tenant: TenantRecord,
    auditEvent: AuditEvent,
  ): Promise<void>;
  updateTenantStatus(input: {
    hostId: string;
    tenantId: string;
    status: TenantStatus;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRecord | null>;
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
