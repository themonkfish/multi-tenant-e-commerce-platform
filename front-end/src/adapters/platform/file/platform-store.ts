import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  HostConfigSchema,
  type HostConfig,
  type HostStatus,
} from "@/core/domain/host-config";
import {
  HostOwnerInviteSchema,
  HostOwnerSchema,
  TenantOwnerInviteSchema,
  TenantOwnerSchema,
  TenantDomainClaimSchema,
  TenantRecordSchema,
  TenantStoreSettingsSchema,
  createDefaultTenantStoreSettings,
  type HostOwner,
  type HostOwnerInvite,
  type TenantOwner,
  type TenantOwnerInvite,
  type TenantDomainClaim,
  type TenantRecord,
  type TenantStoreSettings,
  type TenantStatus,
} from "@/core/domain/host-portal";
import {
  CustomerAccountSchema,
  CustomerOrderSchema,
  TenantStaffSchema,
  TenantStaffViewSchema,
  type CustomerAccount,
  type CustomerOrder,
  type TenantStaff,
  type TenantStaffPermission,
} from "@/core/domain/tenant-identities";
import {
  TenantRestDataProviderConfigSchema,
  type TenantRestDataProviderConfig,
} from "@/core/domain/tenant-config";
import {
  DEFAULT_PLATFORM_SETTINGS,
  PlatformSettingsSchema,
} from "@/core/domain/platform-settings";
import type {
  AuditEvent,
  BootstrapInput,
  PlatformSetupState,
  PlatformStore,
  SecretRecord,
  SuperAdminRecord,
} from "@/core/ports/platform-store";
import { timingSafeStringEqual } from "@/lib/server/crypto";
import { getServerEnv } from "@/lib/server/env";

const SuperAdminSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  passwordHash: z.string().min(1),
  totpSecretCiphertext: z.string().min(1),
  recoveryCodeHashes: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

const AuditEventSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  scope: z
    .object({
      kind: z.enum(["platform", "host", "tenant"]),
      id: z.string().min(1),
    })
    .passthrough(),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().optional(),
  createdAt: z.iso.datetime(),
});

const SecretRecordSchema = z.object({
  ref: z.string().min(1),
  tenantId: z.string().optional(),
  name: z.string().min(1),
  encryptedValue: z.string().min(1),
  createdAt: z.iso.datetime(),
});

const FileStateSchema = z.object({
  initialized: z.boolean(),
  setupTokenHash: z.string().nullable(),
  platformDomain: z.string().nullable(),
  reservedSubdomains: z.array(z.string()),
  platformSettings: PlatformSettingsSchema.default(DEFAULT_PLATFORM_SETTINGS),
  superAdmins: z.array(SuperAdminSchema),
  hosts: z.array(HostConfigSchema).default([]),
  hostOwnerInvites: z.array(HostOwnerInviteSchema).default([]),
  hostOwners: z.array(HostOwnerSchema).default([]),
  tenantOwnerInvites: z.array(TenantOwnerInviteSchema).default([]),
  tenantOwners: z.array(TenantOwnerSchema).default([]),
  tenantStaff: z.array(TenantStaffSchema).default([]),
  customerAccounts: z.array(CustomerAccountSchema).default([]),
  customerOrders: z.array(CustomerOrderSchema).default([]),
  tenants: z.array(TenantRecordSchema).default([]),
  tenantDomainClaims: z.array(TenantDomainClaimSchema).default([]),
  tenantStoreSettings: z
    .array(
      z.object({
        tenantId: z.uuid(),
        hostId: z.uuid(),
        settings: TenantStoreSettingsSchema,
        updatedAt: z.iso.datetime(),
      }),
    )
    .default([]),
  tenantRestConnections: z
    .array(
      z.object({
        tenantId: z.uuid(),
        hostId: z.uuid(),
        config: TenantRestDataProviderConfigSchema,
        updatedAt: z.iso.datetime(),
      }),
    )
    .default([]),
  auditEvents: z.array(AuditEventSchema),
  secrets: z.array(SecretRecordSchema),
  rateLimits: z.record(
    z.string(),
    z.object({ count: z.number().int().nonnegative(), resetAt: z.number() }),
  ),
});

type FileState = z.infer<typeof FileStateSchema>;

const EMPTY_STATE: FileState = {
  initialized: false,
  setupTokenHash: null,
  platformDomain: null,
  reservedSubdomains: [],
  platformSettings: DEFAULT_PLATFORM_SETTINGS,
  superAdmins: [],
  hosts: [],
  hostOwnerInvites: [],
  hostOwners: [],
  tenantOwnerInvites: [],
  tenantOwners: [],
  tenantStaff: [],
  customerAccounts: [],
  customerOrders: [],
  tenants: [],
  tenantDomainClaims: [],
  tenantStoreSettings: [],
  tenantRestConnections: [],
  auditEvents: [],
  secrets: [],
  rateLimits: {},
};

export class FilePlatformStore implements PlatformStore {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(
    filePath = getServerEnv().PLATFORM_STORE_FILE ??
      ".local/platform-store.json",
  ) {
    this.filePath = resolve(/* turbopackIgnore: true */ filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  async getSetupState(): Promise<PlatformSetupState> {
    const state = await this.readState();
    return {
      initialized: state.initialized,
      ...(state.platformDomain ? { platformDomain: state.platformDomain } : {}),
      reservedSubdomains: state.reservedSubdomains,
      settings: state.platformSettings,
    };
  }

  async getBootstrapAdmin(
    setupTokenHash: string,
    email: string,
  ): Promise<SuperAdminRecord | null> {
    const state = await this.readState();
    if (
      state.initialized ||
      !state.setupTokenHash ||
      !timingSafeStringEqual(state.setupTokenHash, setupTokenHash)
    ) {
      return null;
    }

    return (
      state.superAdmins.find(
        (admin) => admin.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    );
  }

  async createInitialSuperAdmin(input: BootstrapInput): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      if (
        state.initialized ||
        state.setupTokenHash ||
        state.superAdmins.length
      ) {
        throw new Error("Platform setup has already been started");
      }

      state.setupTokenHash = input.setupTokenHash;
      state.platformDomain = input.platformDomain;
      state.reservedSubdomains = input.reservedSubdomains;
      state.platformSettings = PlatformSettingsSchema.parse(input.settings);
      state.superAdmins.push(input.superAdmin);
      await this.writeState(state);
    });
  }

  async getSuperAdminByEmail(email: string): Promise<SuperAdminRecord | null> {
    const state = await this.readState();
    return (
      state.superAdmins.find(
        (admin) => admin.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    );
  }

  async consumeRecoveryCode(
    adminId: string,
    codeHash: string,
  ): Promise<boolean> {
    return this.withLock(async () => {
      const state = await this.readState();
      const admin = state.superAdmins.find(
        (candidate) => candidate.id === adminId,
      );
      if (!admin) {
        return false;
      }

      const index = admin.recoveryCodeHashes.indexOf(codeHash);
      if (index === -1) {
        return false;
      }
      admin.recoveryCodeHashes.splice(index, 1);
      await this.writeState(state);
      return true;
    });
  }

  async completeBootstrap(input: {
    setupTokenHash: string;
    email: string;
    recoveryCodeHashes: string[];
    auditEvent: AuditEvent;
  }): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const admin = state.superAdmins.find(
        (candidate) => candidate.email === input.email.toLowerCase(),
      );

      if (
        state.initialized ||
        !state.setupTokenHash ||
        !admin ||
        !timingSafeStringEqual(state.setupTokenHash, input.setupTokenHash)
      ) {
        throw new Error("Platform setup cannot be completed");
      }

      admin.recoveryCodeHashes = input.recoveryCodeHashes;
      state.initialized = true;
      state.setupTokenHash = null;
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
    });
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      state.auditEvents.push(event);
      await this.writeState(state);
    });
  }

  async listHosts(): Promise<HostConfig[]> {
    return (await this.readState()).hosts.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async getHostById(id: string): Promise<HostConfig | null> {
    const state = await this.readState();
    return state.hosts.find((host) => host.id === id) ?? null;
  }

  async getHostByDomain(domain: string): Promise<HostConfig | null> {
    const state = await this.readState();
    return state.hosts.find((host) => host.domains.includes(domain)) ?? null;
  }

  async createHost(host: HostConfig, auditEvent: AuditEvent): Promise<void> {
    const validatedHost = HostConfigSchema.parse(host);
    await this.withLock(async () => {
      const state = await this.readState();
      if (state.hosts.some((candidate) => candidate.slug === host.slug)) {
        throw new Error("A host with this slug already exists");
      }
      const existingDomains = new Set([
        ...state.hosts.flatMap((candidate) => candidate.domains),
        ...state.tenants.flatMap((candidate) => candidate.domains),
        ...state.tenantDomainClaims.map((claim) => claim.domain),
      ]);
      if (host.domains.some((domain) => existingDomains.has(domain))) {
        throw new Error("A host with one of these domains already exists");
      }

      state.hosts.push(validatedHost);
      state.auditEvents.push(auditEvent);
      await this.writeState(state);
    });
  }

  async updateHostStatus(
    id: string,
    status: HostStatus,
    updatedAt: string,
    auditEvent: AuditEvent,
  ): Promise<HostConfig | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const host = state.hosts.find((candidate) => candidate.id === id);
      if (!host) {
        return null;
      }

      host.status = status;
      host.updatedAt = updatedAt;
      state.auditEvents.push(auditEvent);
      await this.writeState(state);
      return host;
    });
  }

  async createHostOwnerInvite(
    invite: HostOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedInvite = HostOwnerInviteSchema.parse(invite);
    await this.withLock(async () => {
      const state = await this.readState();
      const host = state.hosts.find(
        (candidate) => candidate.id === validatedInvite.hostId,
      );
      if (!host || host.status !== "active") {
        throw new Error("Only active hosts can receive owner invitations");
      }
      if (
        state.hostOwners.some((owner) => owner.email === validatedInvite.email)
      ) {
        throw new Error("This email already owns a host account");
      }
      state.hostOwnerInvites = state.hostOwnerInvites.filter(
        (existing) =>
          existing.hostId !== validatedInvite.hostId ||
          existing.email !== validatedInvite.email,
      );
      state.hostOwnerInvites.push(validatedInvite);
      state.auditEvents.push(auditEvent);
      await this.writeState(state);
    });
  }

  async getHostOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<HostOwnerInvite | null> {
    const state = await this.readState();
    const invite = state.hostOwnerInvites.find(
      (candidate) =>
        candidate.tokenHash === tokenHash && candidate.expiresAt > now,
    );
    if (!invite) {
      return null;
    }
    const host = state.hosts.find(
      (candidate) => candidate.id === invite.hostId,
    );
    return host?.status === "active" ? invite : null;
  }

  async acceptHostOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<HostOwner | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const inviteIndex = state.hostOwnerInvites.findIndex(
        (candidate) =>
          candidate.tokenHash === input.tokenHash &&
          candidate.expiresAt > input.now,
      );
      if (inviteIndex === -1) {
        return null;
      }
      const invite = state.hostOwnerInvites[inviteIndex];
      const host = state.hosts.find(
        (candidate) => candidate.id === invite.hostId,
      );
      if (
        !host ||
        host.status !== "active" ||
        state.hostOwners.some((owner) => owner.email === invite.email)
      ) {
        return null;
      }

      const owner = HostOwnerSchema.parse({
        id: randomUUID(),
        hostId: invite.hostId,
        email: invite.email,
        passwordHash: input.passwordHash,
        createdAt: input.now,
      });
      state.hostOwners.push(owner);
      state.hostOwnerInvites.splice(inviteIndex, 1);
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return owner;
    });
  }

  async getHostOwnerByEmail(email: string): Promise<HostOwner | null> {
    const owner = (await this.readState()).hostOwners.find(
      (candidate) => candidate.email === email.trim().toLowerCase(),
    );
    return owner ?? null;
  }

  async createTenantOwnerInvite(
    invite: TenantOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedInvite = TenantOwnerInviteSchema.parse(invite);
    await this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === validatedInvite.tenantId &&
          candidate.hostId === validatedInvite.hostId,
      );
      const host = state.hosts.find(
        (candidate) => candidate.id === validatedInvite.hostId,
      );
      if (
        !tenant ||
        tenant.status !== "active" ||
        !host ||
        host.status !== "active"
      ) {
        throw new Error(
          "Only active tenants on active hosts can receive owner invitations",
        );
      }
      if (
        state.tenantOwners.some(
          (owner) =>
            owner.email === validatedInvite.email ||
            owner.tenantId === validatedInvite.tenantId,
        )
      ) {
        throw new Error("This email or tenant already has a tenant owner");
      }
      state.tenantOwnerInvites = state.tenantOwnerInvites.filter(
        (existing) =>
          existing.tenantId !== validatedInvite.tenantId ||
          existing.email !== validatedInvite.email,
      );
      state.tenantOwnerInvites.push(validatedInvite);
      state.auditEvents.push(auditEvent);
      await this.writeState(state);
    });
  }

  async getTenantOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<TenantOwnerInvite | null> {
    const state = await this.readState();
    const invite = state.tenantOwnerInvites.find(
      (candidate) =>
        candidate.tokenHash === tokenHash && candidate.expiresAt > now,
    );
    if (!invite) {
      return null;
    }
    const tenant = state.tenants.find(
      (candidate) =>
        candidate.id === invite.tenantId && candidate.hostId === invite.hostId,
    );
    const host = state.hosts.find(
      (candidate) => candidate.id === invite.hostId,
    );
    return tenant?.status === "active" && host?.status === "active"
      ? invite
      : null;
  }

  async acceptTenantOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<TenantOwner | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const inviteIndex = state.tenantOwnerInvites.findIndex(
        (candidate) =>
          candidate.tokenHash === input.tokenHash &&
          candidate.expiresAt > input.now,
      );
      if (inviteIndex === -1) {
        return null;
      }
      const invite = state.tenantOwnerInvites[inviteIndex];
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === invite.tenantId &&
          candidate.hostId === invite.hostId &&
          candidate.status === "active",
      );
      const host = state.hosts.find(
        (candidate) =>
          candidate.id === invite.hostId && candidate.status === "active",
      );
      if (
        !tenant ||
        !host ||
        state.tenantOwners.some((owner) => owner.email === invite.email)
      ) {
        return null;
      }

      const owner = TenantOwnerSchema.parse({
        id: randomUUID(),
        tenantId: invite.tenantId,
        hostId: invite.hostId,
        email: invite.email,
        passwordHash: input.passwordHash,
        createdAt: input.now,
      });
      state.tenantOwners.push(owner);
      state.tenantOwnerInvites = state.tenantOwnerInvites.filter(
        (candidate) => candidate.tenantId !== invite.tenantId,
      );
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return owner;
    });
  }

  async getTenantOwnerByEmail(email: string): Promise<TenantOwner | null> {
    const owner = (await this.readState()).tenantOwners.find(
      (candidate) => candidate.email === email.trim().toLowerCase(),
    );
    return owner ?? null;
  }

  async getTenantOwnerByTenant(tenantId: string): Promise<TenantOwner | null> {
    const owner = (await this.readState()).tenantOwners.find(
      (candidate) => candidate.tenantId === tenantId,
    );
    return owner ?? null;
  }

  async getTenantOwnerForTenant(
    ownerId: string,
    tenantId: string,
  ): Promise<TenantOwner | null> {
    const owner = (await this.readState()).tenantOwners.find(
      (candidate) =>
        candidate.id === ownerId && candidate.tenantId === tenantId,
    );
    return owner ?? null;
  }

  async listTenantStaff(
    tenantId: string,
  ): Promise<Omit<TenantStaff, "passwordHash">[]> {
    return (await this.readState()).tenantStaff
      .filter((staff) => staff.tenantId === tenantId)
      .map((staff) => TenantStaffViewSchema.parse(staff));
  }

  async createTenantStaff(input: {
    id: string;
    tenantId: string;
    hostId: string;
    email: string;
    passwordHash: string;
    permissions: TenantStaffPermission[];
    createdAt: string;
  }): Promise<TenantStaff> {
    const staff = TenantStaffSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
      active: true,
    });
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === staff.tenantId &&
          candidate.hostId === staff.hostId &&
          candidate.status === "active",
      );
      const host = state.hosts.find(
        (candidate) =>
          candidate.id === staff.hostId && candidate.status === "active",
      );
      if (!tenant || !host) {
        throw new Error("Tenant is unavailable");
      }
      if (
        state.tenantOwners.some(
          (owner) =>
            owner.email === staff.email && owner.tenantId === staff.tenantId,
        ) ||
        state.tenantStaff.some(
          (owner) =>
            owner.email === staff.email && owner.tenantId === staff.tenantId,
        )
      ) {
        throw new Error(
          "An account with this email already exists for the tenant",
        );
      }
      state.tenantStaff.push(staff);
      await this.writeState(state);
      return staff;
    });
  }

  async updateTenantStaff(input: {
    staffId: string;
    tenantId: string;
    active?: boolean;
    passwordHash?: string;
  }): Promise<TenantStaff | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const staff = state.tenantStaff.find(
        (candidate) =>
          candidate.id === input.staffId &&
          candidate.tenantId === input.tenantId,
      );
      if (!staff) return null;

      if (input.active !== undefined) staff.active = input.active;
      if (input.passwordHash !== undefined) {
        staff.passwordHash = input.passwordHash;
      }
      const updated = TenantStaffSchema.parse(staff);
      await this.writeState(state);
      return updated;
    });
  }

  async getTenantStaffByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantStaff | null> {
    return (
      (await this.readState()).tenantStaff.find(
        (staff) =>
          staff.tenantId === tenantId &&
          staff.email === email.trim().toLowerCase() &&
          staff.active,
      ) ?? null
    );
  }

  async getTenantStaffForTenant(
    staffId: string,
    tenantId: string,
  ): Promise<TenantStaff | null> {
    return (
      (await this.readState()).tenantStaff.find(
        (staff) =>
          staff.id === staffId && staff.tenantId === tenantId && staff.active,
      ) ?? null
    );
  }

  async getCustomerAccountByEmail(
    tenantId: string,
    email: string,
  ): Promise<CustomerAccount | null> {
    return (
      (await this.readState()).customerAccounts.find(
        (account) =>
          account.tenantId === tenantId &&
          account.email === email.trim().toLowerCase(),
      ) ?? null
    );
  }

  async getCustomerAccountForTenant(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAccount | null> {
    return (
      (await this.readState()).customerAccounts.find(
        (account) => account.tenantId === tenantId && account.id === customerId,
      ) ?? null
    );
  }

  async createCustomerAccount(input: {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    createdAt: string;
  }): Promise<CustomerAccount> {
    const account = CustomerAccountSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
    });
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === account.tenantId && candidate.status === "active",
      );
      const host = tenant
        ? state.hosts.find(
            (candidate) =>
              candidate.id === tenant.hostId && candidate.status === "active",
          )
        : null;
      if (!tenant || !host) {
        throw new Error("Tenant is unavailable");
      }
      if (
        state.customerAccounts.some(
          (candidate) =>
            candidate.tenantId === account.tenantId &&
            candidate.email === account.email,
        )
      ) {
        throw new Error("A customer account already exists for this email");
      }
      state.customerAccounts.push(account);
      await this.writeState(state);
      return account;
    });
  }

  async createCustomerOrder(
    input: CustomerOrder,
  ): Promise<{ order: CustomerOrder; created: boolean }> {
    const order = CustomerOrderSchema.parse(input);
    return this.withLock(async () => {
      const state = await this.readState();
      const existing = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === order.tenantId && candidate.id === order.id,
      );
      if (existing) {
        if (existing.customerId !== order.customerId) {
          throw new Error("Order ID is already used by another customer");
        }
        return { order: existing, created: false };
      }
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === order.tenantId && candidate.status === "active",
      );
      const host = tenant
        ? state.hosts.find(
            (candidate) =>
              candidate.id === tenant.hostId && candidate.status === "active",
          )
        : null;
      const customer = state.customerAccounts.find(
        (candidate) =>
          candidate.id === order.customerId &&
          candidate.tenantId === order.tenantId,
      );
      if (!tenant || !host || !customer) {
        throw new Error("Customer or tenant is unavailable");
      }
      state.customerOrders.push(order);
      await this.writeState(state);
      return { order, created: true };
    });
  }

  async getCustomerOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
  ): Promise<CustomerOrder | null> {
    return (
      (await this.readState()).customerOrders.find(
        (order) =>
          order.tenantId === tenantId &&
          order.customerId === customerId &&
          order.id === orderId,
      ) ?? null
    );
  }

  async prepareCustomerOrderPayment(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
  }): Promise<{ order: CustomerOrder; attempt: number } | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const order = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.customerId === input.customerId &&
          candidate.id === input.orderId,
      );
      if (
        !order ||
        order.paymentStatus === "paid" ||
        (order.paymentStatus === "pending" && order.paymentSessionId)
      ) {
        return null;
      }
      if (order.paymentStatus === "failed") {
        order.paymentAttempt += 1;
        order.paymentStatus = "pending";
        delete order.paymentSessionId;
        delete order.paymentIntentId;
      } else if (order.paymentAttempt === 0) {
        order.paymentAttempt = 1;
      }
      const updated = CustomerOrderSchema.parse(order);
      await this.writeState(state);
      return { order: updated, attempt: updated.paymentAttempt };
    });
  }

  async saveCustomerOrderPaymentSession(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    attempt: number;
    sessionId: string;
  }): Promise<CustomerOrder | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const order = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.customerId === input.customerId &&
          candidate.id === input.orderId &&
          candidate.paymentStatus === "pending" &&
          candidate.paymentAttempt === input.attempt,
      );
      if (!order) return null;
      if (
        order.paymentSessionId &&
        order.paymentSessionId !== input.sessionId
      ) {
        return null;
      }
      order.paymentSessionId = input.sessionId;
      const updated = CustomerOrderSchema.parse(order);
      await this.writeState(state);
      return updated;
    });
  }

  async updateCustomerOrderPayment(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    sessionId: string;
    status: CustomerOrder["paymentStatus"];
    paymentIntentId?: string;
  }): Promise<CustomerOrder | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const order = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.customerId === input.customerId &&
          candidate.id === input.orderId &&
          candidate.paymentSessionId === input.sessionId,
      );
      if (!order) return null;
      if (order.paymentStatus === "paid" && input.status !== "paid") {
        return order;
      }
      if (input.status === "failed" && order.paymentStatus !== "pending") {
        return order;
      }
      order.paymentStatus = input.status;
      if (input.paymentIntentId) {
        order.paymentIntentId = input.paymentIntentId;
      }
      const updated = CustomerOrderSchema.parse(order);
      await this.writeState(state);
      return updated;
    });
  }

  async listCustomerOrders(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerOrder[]> {
    return (await this.readState()).customerOrders
      .filter(
        (order) =>
          order.tenantId === tenantId && order.customerId === customerId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateCustomerOrderSync(input: {
    tenantId: string;
    customerId: string;
    orderId: string;
    status: CustomerOrder["backendSyncStatus"];
    error?: string;
  }): Promise<CustomerOrder | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const order = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.customerId === input.customerId &&
          candidate.id === input.orderId,
      );
      if (!order) return null;

      order.backendSyncStatus = input.status;
      if (input.error) order.backendSyncError = input.error;
      else delete order.backendSyncError;
      const updated = CustomerOrderSchema.parse(order);
      await this.writeState(state);
      return updated;
    });
  }

  async updateCustomerOrderStatus(input: {
    tenantId: string;
    orderId: string;
    status: CustomerOrder["status"];
  }): Promise<CustomerOrder | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const order = state.customerOrders.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.id === input.orderId,
      );
      if (!order) return null;
      order.status = input.status;
      const updated = CustomerOrderSchema.parse(order);
      await this.writeState(state);
      return updated;
    });
  }

  async getTenantStoreSettings(
    tenantId: string,
    hostId: string,
    tenantName: string,
  ): Promise<TenantStoreSettings> {
    const state = await this.readState();
    const tenant = state.tenants.find(
      (candidate) => candidate.id === tenantId && candidate.hostId === hostId,
    );
    if (!tenant) {
      throw new Error("Tenant not found in requested host scope");
    }
    const record = state.tenantStoreSettings.find(
      (candidate) =>
        candidate.tenantId === tenantId && candidate.hostId === hostId,
    );
    return record?.settings ?? createDefaultTenantStoreSettings(tenantName);
  }

  async updateTenantStoreSettings(input: {
    tenantId: string;
    hostId: string;
    settings: TenantStoreSettings;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantStoreSettings | null> {
    const settings = TenantStoreSettingsSchema.parse(input.settings);
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === input.tenantId &&
          candidate.hostId === input.hostId &&
          candidate.status === "active",
      );
      const host = state.hosts.find(
        (candidate) =>
          candidate.id === input.hostId && candidate.status === "active",
      );
      if (!tenant || !host) {
        return null;
      }

      const settingsIndex = state.tenantStoreSettings.findIndex(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.hostId === input.hostId,
      );
      const record = {
        tenantId: input.tenantId,
        hostId: input.hostId,
        settings,
        updatedAt: input.updatedAt,
      };
      if (settingsIndex === -1) {
        state.tenantStoreSettings.push(record);
      } else {
        state.tenantStoreSettings[settingsIndex] = record;
      }
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return settings;
    });
  }

  async getTenantRestConnection(
    tenantId: string,
    hostId: string,
  ): Promise<TenantRestDataProviderConfig | null> {
    const state = await this.readState();
    const tenant = state.tenants.find(
      (candidate) => candidate.id === tenantId && candidate.hostId === hostId,
    );
    if (!tenant) {
      throw new Error("Tenant not found in requested host scope");
    }
    return (
      state.tenantRestConnections.find(
        (candidate) =>
          candidate.tenantId === tenantId && candidate.hostId === hostId,
      )?.config ?? null
    );
  }

  async updateTenantRestConnection(input: {
    tenantId: string;
    hostId: string;
    config: TenantRestDataProviderConfig;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRestDataProviderConfig | null> {
    const config = TenantRestDataProviderConfigSchema.parse(input.config);
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === input.tenantId &&
          candidate.hostId === input.hostId &&
          candidate.status === "active",
      );
      const host = state.hosts.find(
        (candidate) =>
          candidate.id === input.hostId && candidate.status === "active",
      );
      if (!tenant || !host) {
        return null;
      }

      const configIndex = state.tenantRestConnections.findIndex(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.hostId === input.hostId,
      );
      const record = {
        tenantId: input.tenantId,
        hostId: input.hostId,
        config,
        updatedAt: input.updatedAt,
      };
      if (configIndex === -1) {
        state.tenantRestConnections.push(record);
      } else {
        state.tenantRestConnections[configIndex] = record;
      }
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return config;
    });
  }

  async listTenantsForHost(hostId: string): Promise<TenantRecord[]> {
    return (await this.readState()).tenants
      .filter((tenant) => tenant.hostId === hostId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listTenantDomainClaims(hostId: string): Promise<TenantDomainClaim[]> {
    return (await this.readState()).tenantDomainClaims.filter(
      (claim) => claim.hostId === hostId,
    );
  }

  async createTenantDomainClaim(input: {
    hostId: string;
    tenantId: string;
    domain: string;
    verificationToken: string;
    createdAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantDomainClaim | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === input.tenantId && candidate.hostId === input.hostId,
      );
      const host = state.hosts.find(
        (candidate) =>
          candidate.id === input.hostId && candidate.status === "active",
      );
      if (!tenant || !host) {
        return null;
      }
      if (
        state.hosts.some((candidate) =>
          candidate.domains.includes(input.domain),
        ) ||
        state.tenants.some((candidate) =>
          candidate.domains.includes(input.domain),
        ) ||
        state.tenantDomainClaims.some((claim) => claim.domain === input.domain)
      ) {
        throw new Error("A tenant with this domain already exists");
      }
      const assignedDomains =
        host.domains.length +
        state.tenants
          .filter((candidate) => candidate.hostId === host.id)
          .reduce((count, candidate) => count + candidate.domains.length, 0) +
        state.tenantDomainClaims.filter((claim) => claim.hostId === host.id)
          .length;
      if (assignedDomains >= host.limits.maxCustomDomains) {
        throw new Error("Host custom-domain limit reached");
      }
      const claim = TenantDomainClaimSchema.parse({
        tenantId: input.tenantId,
        hostId: input.hostId,
        domain: input.domain,
        verificationToken: input.verificationToken,
        createdAt: input.createdAt,
      });
      state.tenantDomainClaims.push(claim);
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return claim;
    });
  }

  async completeTenantDomainClaim(input: {
    hostId: string;
    tenantId: string;
    domain: string;
    verificationToken: string;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRecord | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === input.tenantId && candidate.hostId === input.hostId,
      );
      const claimIndex = state.tenantDomainClaims.findIndex(
        (claim) =>
          claim.hostId === input.hostId &&
          claim.tenantId === input.tenantId &&
          claim.domain === input.domain &&
          claim.verificationToken === input.verificationToken,
      );
      if (!tenant || claimIndex === -1) {
        return null;
      }
      if (
        state.hosts.some((candidate) =>
          candidate.domains.includes(input.domain),
        ) ||
        state.tenants.some(
          (candidate) =>
            candidate.id !== tenant.id &&
            candidate.domains.includes(input.domain),
        )
      ) {
        throw new Error("A tenant with this domain already exists");
      }
      tenant.domains = [...new Set([...tenant.domains, input.domain])];
      tenant.updatedAt = input.updatedAt;
      state.tenantDomainClaims.splice(claimIndex, 1);
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return tenant;
    });
  }

  async getTenantByDomain(domain: string): Promise<TenantRecord | null> {
    const state = await this.readState();
    return (
      state.tenants.find((tenant) => tenant.domains.includes(domain)) ?? null
    );
  }

  async createTenantForHost(
    tenant: TenantRecord,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedTenant = TenantRecordSchema.parse(tenant);
    await this.withLock(async () => {
      const state = await this.readState();
      const host = state.hosts.find(
        (candidate) => candidate.id === validatedTenant.hostId,
      );
      if (!host || host.status !== "active") {
        throw new Error("Host is unavailable");
      }
      if (
        state.tenants.some(
          (candidate) =>
            candidate.hostId === host.id &&
            candidate.slug === validatedTenant.slug,
        )
      ) {
        throw new Error("A tenant with this slug already exists for the host");
      }
      if (
        state.tenants.some((candidate) =>
          candidate.domains.some((domain) =>
            validatedTenant.domains.includes(domain),
          ),
        ) ||
        state.tenantDomainClaims.some((claim) =>
          validatedTenant.domains.includes(claim.domain),
        ) ||
        state.hosts.some((candidate) =>
          candidate.domains.some((domain) =>
            validatedTenant.domains.includes(domain),
          ),
        )
      ) {
        throw new Error("A tenant with one of these domains already exists");
      }
      if (
        state.tenants.filter((candidate) => candidate.hostId === host.id)
          .length >= host.limits.maxTenants
      ) {
        throw new Error("Host tenant limit reached");
      }
      const assignedDomains =
        host.domains.length +
        state.tenants
          .filter((candidate) => candidate.hostId === host.id)
          .reduce((count, candidate) => count + candidate.domains.length, 0) +
        state.tenantDomainClaims.filter((claim) => claim.hostId === host.id)
          .length;
      if (
        assignedDomains + validatedTenant.domains.length >
        host.limits.maxCustomDomains
      ) {
        throw new Error("Host custom-domain limit reached");
      }

      state.tenants.push(validatedTenant);
      state.auditEvents.push(auditEvent);
      await this.writeState(state);
    });
  }

  async updateTenantStatus(input: {
    hostId: string;
    tenantId: string;
    status: TenantStatus;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRecord | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const tenant = state.tenants.find(
        (candidate) =>
          candidate.id === input.tenantId && candidate.hostId === input.hostId,
      );
      if (!tenant) {
        return null;
      }

      tenant.status = input.status;
      tenant.updatedAt = input.updatedAt;
      state.auditEvents.push(input.auditEvent);
      await this.writeState(state);
      return tenant;
    });
  }

  async putSecretRecord(record: SecretRecord): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const existingIndex = state.secrets.findIndex(
        (secret) => secret.ref === record.ref,
      );
      if (existingIndex === -1) {
        state.secrets.push(record);
      } else {
        state.secrets[existingIndex] = record;
      }
      await this.writeState(state);
    });
  }

  async getSecretRecord(ref: string): Promise<SecretRecord | null> {
    const state = await this.readState();
    return state.secrets.find((secret) => secret.ref === ref) ?? null;
  }

  async deleteSecretRecord(ref: string): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      state.secrets = state.secrets.filter((secret) => secret.ref !== ref);
      await this.writeState(state);
    });
  }

  async consumeRateLimit(input: {
    key: string;
    limit: number;
    windowMs: number;
    now: number;
  }): Promise<boolean> {
    return this.withLock(async () => {
      const state = await this.readState();
      const current = state.rateLimits[input.key];
      const entry =
        current && current.resetAt > input.now
          ? current
          : { count: 0, resetAt: input.now + input.windowMs };

      if (entry.count >= input.limit) {
        return false;
      }

      state.rateLimits[input.key] = {
        count: entry.count + 1,
        resetAt: entry.resetAt,
      };
      for (const [key, rateLimit] of Object.entries(state.rateLimits)) {
        if (rateLimit.resetAt <= input.now) {
          delete state.rateLimits[key];
        }
      }
      await this.writeState(state);
      return true;
    });
  }

  private async readState(): Promise<FileState> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      return FileStateSchema.parse(JSON.parse(contents));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async writeState(state: FileState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(FileStateSchema.parse(state)));
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (!hasErrorCode(cleanupError, "ENOENT")) {
          throw cleanupError;
        }
      });
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    let lock;
    try {
      lock = await open(this.lockPath, "wx", 0o600);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new Error(
          "Platform store is locked by another setup operation; retry after it completes",
        );
      }
      throw error;
    }

    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(this.lockPath);
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
