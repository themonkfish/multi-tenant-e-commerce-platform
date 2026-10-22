import "server-only";
import { randomUUID } from "node:crypto";
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
  TenantRecordSchema,
  TenantStoreSettingsSchema,
  createDefaultTenantStoreSettings,
  type HostOwner,
  type HostOwnerInvite,
  type TenantOwner,
  type TenantOwnerInvite,
  type TenantRecord,
  type TenantStoreSettings,
  type TenantStatus,
} from "@/core/domain/host-portal";
import {
  CustomerAccountSchema,
  CustomerOrderSchema,
  TenantStaffPermissionSchema,
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
import type {
  AuditEvent,
  BootstrapInput,
  PlatformSetupState,
  PlatformStore,
  SecretRecord,
  SuperAdminRecord,
} from "@/core/ports/platform-store";
import { createPlatformSupabaseClient } from "./client";

export class SupabasePlatformStore implements PlatformStore {
  private readonly client = createPlatformSupabaseClient();

  async getSetupState(): Promise<PlatformSetupState> {
    const { data, error } = await this.client
      .from("platform_state")
      .select("initialized, platform_domain, reserved_subdomains")
      .eq("id", 1)
      .single();
    if (error) {
      throw new Error(`Could not load platform setup state: ${error.message}`);
    }

    return {
      initialized: data.initialized,
      ...(data.platform_domain ? { platformDomain: data.platform_domain } : {}),
      reservedSubdomains: data.reserved_subdomains,
    };
  }

  async getBootstrapAdmin(
    setupTokenHash: string,
    email: string,
  ): Promise<SuperAdminRecord | null> {
    const [stateResult, adminResult] = await Promise.all([
      this.client
        .from("platform_state")
        .select("initialized, setup_token_hash")
        .eq("id", 1)
        .single(),
      this.client
        .from("platform_super_admins")
        .select("*")
        .eq("email", email.toLowerCase())
        .maybeSingle(),
    ]);
    if (stateResult.error || adminResult.error) {
      throw new Error(
        `Could not load bootstrap account: ${stateResult.error?.message ?? adminResult.error?.message}`,
      );
    }
    if (
      stateResult.data.initialized ||
      stateResult.data.setup_token_hash !== setupTokenHash ||
      !adminResult.data
    ) {
      return null;
    }

    return fromAdminRow(adminResult.data);
  }

  async createInitialSuperAdmin(input: BootstrapInput): Promise<void> {
    const { data, error } = await this.client.rpc("claim_platform_bootstrap", {
      p_setup_token_hash: input.setupTokenHash,
      p_platform_domain: input.platformDomain,
      p_reserved_subdomains: input.reservedSubdomains,
      p_admin_id: input.superAdmin.id,
      p_admin_email: input.superAdmin.email.toLowerCase(),
      p_password_hash: input.superAdmin.passwordHash,
      p_totp_secret_ciphertext: input.superAdmin.totpSecretCiphertext,
      p_created_at: input.superAdmin.createdAt,
    });
    if (error) {
      throw new Error(`Could not create initial Super Admin: ${error.message}`);
    }
    if (!data) {
      throw new Error("Platform setup has already been claimed");
    }
  }

  async getSuperAdminByEmail(email: string): Promise<SuperAdminRecord | null> {
    const { data, error } = await this.client
      .from("platform_super_admins")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load Super Admin account: ${error.message}`);
    }

    return data ? fromAdminRow(data) : null;
  }

  async consumeRecoveryCode(
    adminId: string,
    codeHash: string,
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      "consume_platform_recovery_code",
      { p_admin_id: adminId, p_code_hash: codeHash },
    );
    if (error) {
      throw new Error(`Could not consume recovery code: ${error.message}`);
    }
    return data;
  }

  async completeBootstrap(input: {
    setupTokenHash: string;
    email: string;
    recoveryCodeHashes: string[];
    auditEvent: AuditEvent;
  }): Promise<void> {
    const admin = await this.getBootstrapAdmin(
      input.setupTokenHash,
      input.email,
    );
    if (!admin) {
      throw new Error(
        "Platform setup token is invalid or has already been used",
      );
    }

    const { data, error } = await this.client.rpc(
      "finalize_platform_bootstrap",
      {
        p_setup_token_hash: input.setupTokenHash,
        p_admin_id: admin?.id ?? "",
        p_recovery_code_hashes: input.recoveryCodeHashes,
        p_audit_id: input.auditEvent.id,
        p_audit_actor_id: input.auditEvent.actorId,
        p_audit_action: input.auditEvent.action,
        p_audit_resource_type: input.auditEvent.resourceType,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(`Could not complete platform setup: ${error.message}`);
    }
    if (!data) {
      throw new Error(
        "Platform setup token is invalid or has already been used",
      );
    }
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    const { error } = await this.client.from("platform_audit_log").insert({
      id: event.id,
      actor_id: event.actorId,
      scope: event.scope,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      created_at: event.createdAt,
    });
    if (error) {
      throw new Error(`Could not append audit event: ${error.message}`);
    }
  }

  async listHosts(): Promise<HostConfig[]> {
    const [hostsResult, domainsResult] = await Promise.all([
      this.client.from("platform_hosts").select("*").order("name"),
      this.client.from("platform_host_domains").select("host_id, domain"),
    ]);
    if (hostsResult.error || domainsResult.error) {
      throw new Error(
        `Could not load hosts: ${hostsResult.error?.message ?? domainsResult.error?.message}`,
      );
    }

    const domainsByHost = new Map<string, string[]>();
    for (const row of domainsResult.data) {
      const domains = domainsByHost.get(row.host_id) ?? [];
      domains.push(row.domain);
      domainsByHost.set(row.host_id, domains);
    }

    return hostsResult.data.map((row) =>
      HostConfigSchema.parse({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        plan: row.plan,
        limits: row.limits,
        branding: row.branding,
        domains: domainsByHost.get(row.id) ?? [],
        ...(row.support_contact ? { supportContact: row.support_contact } : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async getHostByDomain(domain: string): Promise<HostConfig | null> {
    const { data: domainRow, error: domainError } = await this.client
      .from("platform_host_domains")
      .select("host_id")
      .eq("domain", domain)
      .maybeSingle();
    if (domainError) {
      throw new Error(`Could not load host domain: ${domainError.message}`);
    }
    if (!domainRow) {
      return null;
    }

    return this.getHostById(domainRow.host_id);
  }

  async getHostById(id: string): Promise<HostConfig | null> {
    const [hostResult, domainsResult] = await Promise.all([
      this.client.from("platform_hosts").select("*").eq("id", id).maybeSingle(),
      this.client
        .from("platform_host_domains")
        .select("domain")
        .eq("host_id", id),
    ]);
    if (hostResult.error || domainsResult.error) {
      throw new Error(
        `Could not load host configuration: ${hostResult.error?.message ?? domainsResult.error?.message}`,
      );
    }
    if (!hostResult.data) {
      return null;
    }

    const row = hostResult.data;
    return HostConfigSchema.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      plan: row.plan,
      limits: row.limits,
      branding: row.branding,
      domains: domainsResult.data.map((domainEntry) => domainEntry.domain),
      ...(row.support_contact ? { supportContact: row.support_contact } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async createHost(host: HostConfig, auditEvent: AuditEvent): Promise<void> {
    const validatedHost = HostConfigSchema.parse(host);
    const { data, error } = await this.client.rpc("create_platform_host", {
      p_host_id: validatedHost.id,
      p_slug: validatedHost.slug,
      p_name: validatedHost.name,
      p_status: validatedHost.status,
      p_plan: validatedHost.plan,
      p_limits: validatedHost.limits,
      p_branding: validatedHost.branding,
      p_domains: validatedHost.domains,
      p_support_contact: validatedHost.supportContact ?? null,
      p_created_at: validatedHost.createdAt,
      p_actor_id: auditEvent.actorId,
      p_audit_id: auditEvent.id,
      p_audit_action: auditEvent.action,
      p_audit_resource_type: auditEvent.resourceType,
      p_audit_resource_id: auditEvent.resourceId ?? null,
      p_audit_created_at: auditEvent.createdAt,
    });
    if (error) {
      throw new Error(`Could not create host: ${error.message}`);
    }
    if (!data) {
      throw new Error("A host with this slug or domain already exists");
    }
  }

  async updateHostStatus(
    id: string,
    status: HostStatus,
    updatedAt: string,
    auditEvent: AuditEvent,
  ): Promise<HostConfig | null> {
    const { data, error } = await this.client.rpc(
      "update_platform_host_status",
      {
        p_host_id: id,
        p_status: status,
        p_updated_at: updatedAt,
        p_actor_id: auditEvent.actorId,
        p_audit_id: auditEvent.id,
        p_audit_action: auditEvent.action,
        p_audit_resource_type: auditEvent.resourceType,
        p_audit_resource_id: auditEvent.resourceId ?? null,
        p_audit_created_at: auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(`Could not update host status: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    return (await this.listHosts()).find((host) => host.id === id) ?? null;
  }

  async createHostOwnerInvite(
    invite: HostOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedInvite = HostOwnerInviteSchema.parse(invite);
    const { data, error } = await this.client.rpc(
      "create_platform_host_owner_invite",
      {
        p_invite_id: validatedInvite.id,
        p_host_id: validatedInvite.hostId,
        p_email: validatedInvite.email,
        p_token_hash: validatedInvite.tokenHash,
        p_expires_at: validatedInvite.expiresAt,
        p_created_at: validatedInvite.createdAt,
        p_actor_id: auditEvent.actorId,
        p_audit_id: auditEvent.id,
        p_audit_action: auditEvent.action,
        p_audit_resource_id: auditEvent.resourceId ?? null,
        p_audit_created_at: auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not create host owner invitation: ${error.message}`,
      );
    }
    if (!data) {
      const owner = await this.getHostOwnerByEmail(validatedInvite.email);
      if (owner) {
        throw new Error("This email already owns a host account");
      }
      throw new Error("Only active hosts can receive owner invitations");
    }
  }

  async getHostOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<HostOwnerInvite | null> {
    const { data, error } = await this.client
      .from("platform_host_owner_invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .gt("expires_at", now)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load host owner invitation: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    const host = (await this.listHosts()).find(
      (candidate) => candidate.id === data.host_id,
    );
    if (!host || host.status !== "active") {
      return null;
    }
    return HostOwnerInviteSchema.parse({
      id: data.id,
      hostId: data.host_id,
      email: data.email,
      tokenHash: data.token_hash,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    });
  }

  async acceptHostOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<HostOwner | null> {
    const { data, error } = await this.client.rpc(
      "accept_platform_host_owner_invite",
      {
        p_token_hash: input.tokenHash,
        p_owner_id: randomUUID(),
        p_password_hash: input.passwordHash,
        p_now: input.now,
        p_audit_id: input.auditEvent.id,
        p_audit_actor_id: input.auditEvent.actorId,
        p_audit_action: input.auditEvent.action,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not accept host owner invitation: ${error.message}`,
      );
    }
    if (data === null) {
      return null;
    }
    return HostOwnerSchema.parse(data);
  }

  async getHostOwnerByEmail(email: string): Promise<HostOwner | null> {
    const { data, error } = await this.client
      .from("platform_host_owners")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load host owner: ${error.message}`);
    }
    return data
      ? HostOwnerSchema.parse({
          id: data.id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
  }

  async createTenantOwnerInvite(
    invite: TenantOwnerInvite,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedInvite = TenantOwnerInviteSchema.parse(invite);
    const { data, error } = await this.client.rpc(
      "create_platform_tenant_owner_invite",
      {
        p_invite_id: validatedInvite.id,
        p_tenant_id: validatedInvite.tenantId,
        p_host_id: validatedInvite.hostId,
        p_email: validatedInvite.email,
        p_token_hash: validatedInvite.tokenHash,
        p_expires_at: validatedInvite.expiresAt,
        p_created_at: validatedInvite.createdAt,
        p_actor_id: auditEvent.actorId,
        p_audit_id: auditEvent.id,
        p_audit_action: auditEvent.action,
        p_audit_resource_id: auditEvent.resourceId ?? null,
        p_audit_created_at: auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not create tenant owner invitation: ${error.message}`,
      );
    }
    if (!data) {
      const [owner, tenantOwner] = await Promise.all([
        this.getTenantOwnerByEmail(validatedInvite.email),
        this.getTenantOwnerByTenant(validatedInvite.tenantId),
      ]);
      if (owner || tenantOwner) {
        throw new Error("This email or tenant already has a tenant owner");
      }
      throw new Error(
        "Only active tenants on active hosts can receive owner invitations",
      );
    }
  }

  async getTenantOwnerInvite(
    tokenHash: string,
    now: string,
  ): Promise<TenantOwnerInvite | null> {
    const { data, error } = await this.client
      .from("platform_tenant_owner_invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .gt("expires_at", now)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Could not load tenant owner invitation: ${error.message}`,
      );
    }
    if (!data) {
      return null;
    }

    const [host, tenants] = await Promise.all([
      this.listHosts(),
      this.listTenantsForHost(data.host_id),
    ]);
    const matchingHost = host.find(
      (candidate) => candidate.id === data.host_id,
    );
    const tenant = tenants.find((candidate) => candidate.id === data.tenant_id);
    if (matchingHost?.status !== "active" || tenant?.status !== "active") {
      return null;
    }
    return TenantOwnerInviteSchema.parse({
      id: data.id,
      tenantId: data.tenant_id,
      hostId: data.host_id,
      email: data.email,
      tokenHash: data.token_hash,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    });
  }

  async acceptTenantOwnerInvite(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
    auditEvent: AuditEvent;
  }): Promise<TenantOwner | null> {
    const { data, error } = await this.client.rpc(
      "accept_platform_tenant_owner_invite",
      {
        p_token_hash: input.tokenHash,
        p_owner_id: randomUUID(),
        p_password_hash: input.passwordHash,
        p_now: input.now,
        p_audit_id: input.auditEvent.id,
        p_audit_actor_id: input.auditEvent.actorId,
        p_audit_action: input.auditEvent.action,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not accept tenant owner invitation: ${error.message}`,
      );
    }
    return data === null ? null : TenantOwnerSchema.parse(data);
  }

  async getTenantOwnerByEmail(email: string): Promise<TenantOwner | null> {
    const { data, error } = await this.client
      .from("platform_tenant_owners")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load tenant owner: ${error.message}`);
    }
    return data
      ? TenantOwnerSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
  }

  async getTenantOwnerByTenant(tenantId: string): Promise<TenantOwner | null> {
    const { data, error } = await this.client
      .from("platform_tenant_owners")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load tenant owner: ${error.message}`);
    }
    return data
      ? TenantOwnerSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
  }

  async getTenantOwnerForTenant(
    ownerId: string,
    tenantId: string,
  ): Promise<TenantOwner | null> {
    const { data, error } = await this.client
      .from("platform_tenant_owners")
      .select("*")
      .eq("id", ownerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not verify tenant owner scope: ${error.message}`);
    }
    return data
      ? TenantOwnerSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
  }

  async listTenantStaff(
    tenantId: string,
  ): Promise<Omit<TenantStaff, "passwordHash">[]> {
    const { data, error } = await this.client
      .from("platform_tenant_staff")
      .select("id, tenant_id, host_id, email, permissions, active, created_at")
      .eq("tenant_id", tenantId)
      .order("email");
    if (error) {
      throw new Error(`Could not load tenant staff: ${error.message}`);
    }
    return data.map((row) =>
      TenantStaffViewSchema.parse({
        id: row.id,
        tenantId: row.tenant_id,
        hostId: row.host_id,
        email: row.email,
        permissions: TenantStaffPermissionSchema.array().parse(row.permissions),
        active: row.active,
        createdAt: row.created_at,
      }),
    );
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
    const { data: owner, error: ownerError } = await this.client
      .from("platform_tenant_owners")
      .select("id")
      .eq("tenant_id", staff.tenantId)
      .eq("email", staff.email)
      .maybeSingle();
    if (ownerError) {
      throw new Error(
        `Could not check tenant owner email before staff creation: ${ownerError.message}`,
      );
    }
    if (owner) {
      throw new Error(
        "An account with this email already exists for the tenant",
      );
    }
    const { data, error } = await this.client
      .from("platform_tenant_staff")
      .insert({
        id: staff.id,
        tenant_id: staff.tenantId,
        host_id: staff.hostId,
        email: staff.email,
        password_hash: staff.passwordHash,
        permissions: staff.permissions,
        active: staff.active,
        created_at: staff.createdAt,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error(
          "An account with this email already exists for the tenant",
        );
      }
      throw new Error(
        `Could not create tenant staff account: ${error.message}`,
      );
    }
    return TenantStaffSchema.parse({
      id: data.id,
      tenantId: data.tenant_id,
      hostId: data.host_id,
      email: data.email,
      passwordHash: data.password_hash,
      permissions: TenantStaffPermissionSchema.array().parse(data.permissions),
      active: data.active,
      createdAt: data.created_at,
    });
  }

  async updateTenantStaff(input: {
    staffId: string;
    tenantId: string;
    active?: boolean;
    passwordHash?: string;
  }): Promise<TenantStaff | null> {
    const updates: { active?: boolean; password_hash?: string } = {};
    if (input.active !== undefined) updates.active = input.active;
    if (input.passwordHash !== undefined) {
      updates.password_hash = input.passwordHash;
    }
    const { data, error } = await this.client
      .from("platform_tenant_staff")
      .update(updates)
      .eq("id", input.staffId)
      .eq("tenant_id", input.tenantId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(
        `Could not update tenant staff account: ${error.message}`,
      );
    }
    return data
      ? TenantStaffSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          permissions: TenantStaffPermissionSchema.array().parse(
            data.permissions,
          ),
          active: data.active,
          createdAt: data.created_at,
        })
      : null;
  }

  async getTenantStaffByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantStaff | null> {
    const { data, error } = await this.client
      .from("platform_tenant_staff")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("email", email.trim().toLowerCase())
      .eq("active", true)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load tenant staff account: ${error.message}`);
    }
    return data
      ? TenantStaffSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          permissions: data.permissions,
          active: data.active,
          createdAt: data.created_at,
        })
      : null;
  }

  async getTenantStaffForTenant(
    staffId: string,
    tenantId: string,
  ): Promise<TenantStaff | null> {
    const { data, error } = await this.client
      .from("platform_tenant_staff")
      .select("*")
      .eq("id", staffId)
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not verify tenant staff scope: ${error.message}`);
    }
    return data
      ? TenantStaffSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          hostId: data.host_id,
          email: data.email,
          passwordHash: data.password_hash,
          permissions: data.permissions,
          active: data.active,
          createdAt: data.created_at,
        })
      : null;
  }

  async getCustomerAccountByEmail(
    tenantId: string,
    email: string,
  ): Promise<CustomerAccount | null> {
    const { data, error } = await this.client
      .from("platform_customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load customer account: ${error.message}`);
    }
    return data
      ? CustomerAccountSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
  }

  async getCustomerAccountForTenant(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAccount | null> {
    const { data, error } = await this.client
      .from("platform_customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not verify customer scope: ${error.message}`);
    }
    return data
      ? CustomerAccountSchema.parse({
          id: data.id,
          tenantId: data.tenant_id,
          email: data.email,
          passwordHash: data.password_hash,
          createdAt: data.created_at,
        })
      : null;
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
    const { data, error } = await this.client
      .from("platform_customers")
      .insert({
        id: account.id,
        tenant_id: account.tenantId,
        email: account.email,
        password_hash: account.passwordHash,
        created_at: account.createdAt,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("A customer account already exists for this email");
      }
      throw new Error(`Could not create customer account: ${error.message}`);
    }
    return CustomerAccountSchema.parse({
      id: data.id,
      tenantId: data.tenant_id,
      email: data.email,
      passwordHash: data.password_hash,
      createdAt: data.created_at,
    });
  }

  async createCustomerOrder(
    input: CustomerOrder,
  ): Promise<{ order: CustomerOrder; created: boolean }> {
    const order = CustomerOrderSchema.parse(input);
    const { data, error } = await this.client
      .from("platform_customer_orders")
      .insert({
        id: order.id,
        tenant_id: order.tenantId,
        customer_id: order.customerId,
        status: order.status,
        created_at: order.createdAt,
        items: order.items,
        total: order.total,
        currency: order.currency,
        item_count: order.itemCount,
      })
      .select("*")
      .single();
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await this.client
        .from("platform_customer_orders")
        .select("*")
        .eq("tenant_id", order.tenantId)
        .eq("id", order.id)
        .eq("customer_id", order.customerId)
        .maybeSingle();
      if (lookupError) {
        throw new Error(
          `Could not check an existing customer order: ${lookupError.message}`,
        );
      }
      if (existing) {
        return {
          order: customerOrderFromRow(existing),
          created: false,
        };
      }
    }
    if (error) {
      throw new Error(`Could not create customer order: ${error.message}`);
    }
    return { order: customerOrderFromRow(data), created: true };
  }

  async listCustomerOrders(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerOrder[]> {
    const { data, error } = await this.client
      .from("platform_customer_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`Could not load customer orders: ${error.message}`);
    }
    return data.map(customerOrderFromRow);
  }

  async getTenantStoreSettings(
    tenantId: string,
    hostId: string,
    tenantName: string,
  ): Promise<TenantStoreSettings> {
    const { data, error } = await this.client
      .from("platform_tenant_settings")
      .select("branding, locale")
      .eq("tenant_id", tenantId)
      .eq("host_id", hostId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load tenant store settings: ${error.message}`);
    }
    if (!data) {
      return createDefaultTenantStoreSettings(tenantName);
    }
    return TenantStoreSettingsSchema.parse({
      branding: data.branding,
      locale: data.locale,
    });
  }

  async updateTenantStoreSettings(input: {
    tenantId: string;
    hostId: string;
    settings: TenantStoreSettings;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantStoreSettings | null> {
    const settings = TenantStoreSettingsSchema.parse(input.settings);
    const { data, error } = await this.client.rpc(
      "update_platform_tenant_settings",
      {
        p_tenant_id: input.tenantId,
        p_host_id: input.hostId,
        p_branding: settings.branding,
        p_locale: settings.locale,
        p_updated_at: input.updatedAt,
        p_actor_id: input.auditEvent.actorId,
        p_audit_id: input.auditEvent.id,
        p_audit_action: input.auditEvent.action,
        p_audit_resource_id: input.auditEvent.resourceId ?? null,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not update tenant store settings: ${error.message}`,
      );
    }
    return data ? settings : null;
  }

  async getTenantRestConnection(
    tenantId: string,
    hostId: string,
  ): Promise<TenantRestDataProviderConfig | null> {
    const { data, error } = await this.client
      .from("platform_tenant_rest_connections")
      .select("base_url, api_version, auth_mode, api_key_ref")
      .eq("tenant_id", tenantId)
      .eq("host_id", hostId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Could not load tenant REST connection: ${error.message}`,
      );
    }
    return data
      ? TenantRestDataProviderConfigSchema.parse({
          type: "rest",
          baseUrl: data.base_url,
          apiVersion: data.api_version,
          authMode: data.auth_mode,
          apiKeyRef: data.api_key_ref,
        })
      : null;
  }

  async updateTenantRestConnection(input: {
    tenantId: string;
    hostId: string;
    config: TenantRestDataProviderConfig;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRestDataProviderConfig | null> {
    const config = TenantRestDataProviderConfigSchema.parse(input.config);
    const { data, error } = await this.client.rpc(
      "update_platform_tenant_rest_connection",
      {
        p_tenant_id: input.tenantId,
        p_host_id: input.hostId,
        p_base_url: config.baseUrl,
        p_api_version: config.apiVersion,
        p_api_key_ref: config.apiKeyRef,
        p_updated_at: input.updatedAt,
        p_actor_id: input.auditEvent.actorId,
        p_audit_id: input.auditEvent.id,
        p_audit_action: input.auditEvent.action,
        p_audit_resource_id: input.auditEvent.resourceId ?? null,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(
        `Could not update tenant REST connection: ${error.message}`,
      );
    }
    return data ? config : null;
  }

  async listTenantsForHost(hostId: string): Promise<TenantRecord[]> {
    const [tenantResult, domainResult] = await Promise.all([
      this.client
        .from("platform_tenants")
        .select("*")
        .eq("host_id", hostId)
        .order("name"),
      this.client
        .from("platform_tenant_domains")
        .select("tenant_id, domain")
        .eq("host_id", hostId),
    ]);
    if (tenantResult.error || domainResult.error) {
      throw new Error(
        `Could not load host tenants: ${tenantResult.error?.message ?? domainResult.error?.message}`,
      );
    }
    const domainsByTenant = new Map<string, string[]>();
    for (const row of domainResult.data) {
      const domains = domainsByTenant.get(row.tenant_id) ?? [];
      domains.push(row.domain);
      domainsByTenant.set(row.tenant_id, domains);
    }
    return tenantResult.data.map((row) =>
      TenantRecordSchema.parse({
        id: row.id,
        hostId: row.host_id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        plan: row.plan,
        domains: domainsByTenant.get(row.id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async getTenantByDomain(domain: string): Promise<TenantRecord | null> {
    const { data: domainRow, error: domainError } = await this.client
      .from("platform_tenant_domains")
      .select("tenant_id, host_id")
      .eq("domain", domain)
      .maybeSingle();
    if (domainError) {
      throw new Error(`Could not load tenant domain: ${domainError.message}`);
    }
    if (!domainRow) {
      return null;
    }

    const [tenantResult, domainsResult] = await Promise.all([
      this.client
        .from("platform_tenants")
        .select("*")
        .eq("id", domainRow.tenant_id)
        .eq("host_id", domainRow.host_id)
        .maybeSingle(),
      this.client
        .from("platform_tenant_domains")
        .select("domain")
        .eq("tenant_id", domainRow.tenant_id)
        .eq("host_id", domainRow.host_id),
    ]);
    if (tenantResult.error || domainsResult.error) {
      throw new Error(
        `Could not load tenant configuration: ${tenantResult.error?.message ?? domainsResult.error?.message}`,
      );
    }
    if (!tenantResult.data) {
      return null;
    }

    const row = tenantResult.data;
    return TenantRecordSchema.parse({
      id: row.id,
      hostId: row.host_id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      plan: row.plan,
      domains: domainsResult.data.map((domainEntry) => domainEntry.domain),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async createTenantForHost(
    tenant: TenantRecord,
    auditEvent: AuditEvent,
  ): Promise<void> {
    const validatedTenant = TenantRecordSchema.parse(tenant);
    const { data, error } = await this.client.rpc("create_platform_tenant", {
      p_tenant_id: validatedTenant.id,
      p_host_id: validatedTenant.hostId,
      p_slug: validatedTenant.slug,
      p_name: validatedTenant.name,
      p_status: validatedTenant.status,
      p_plan: validatedTenant.plan,
      p_domains: validatedTenant.domains,
      p_created_at: validatedTenant.createdAt,
      p_actor_id: auditEvent.actorId,
      p_audit_id: auditEvent.id,
      p_audit_action: auditEvent.action,
      p_audit_resource_id: auditEvent.resourceId ?? null,
      p_audit_created_at: auditEvent.createdAt,
    });
    if (error) {
      throw new Error(`Could not create tenant: ${error.message}`);
    }
    if (data !== "created") {
      const failureMessages: Record<string, string> = {
        host_unavailable: "Host is unavailable",
        tenant_limit_reached: "Host tenant limit reached",
        custom_domain_limit_reached: "Host custom-domain limit reached",
        tenant_slug_or_domain_in_use:
          "A tenant with this slug or domain already exists",
      };
      throw new Error(
        failureMessages[data] ?? `Tenant creation failed: ${data}`,
      );
    }
  }

  async updateTenantStatus(input: {
    hostId: string;
    tenantId: string;
    status: TenantStatus;
    updatedAt: string;
    auditEvent: AuditEvent;
  }): Promise<TenantRecord | null> {
    const { data, error } = await this.client.rpc(
      "update_platform_tenant_status",
      {
        p_host_id: input.hostId,
        p_tenant_id: input.tenantId,
        p_status: input.status,
        p_updated_at: input.updatedAt,
        p_actor_id: input.auditEvent.actorId,
        p_audit_id: input.auditEvent.id,
        p_audit_action: input.auditEvent.action,
        p_audit_resource_id: input.auditEvent.resourceId ?? null,
        p_audit_created_at: input.auditEvent.createdAt,
      },
    );
    if (error) {
      throw new Error(`Could not update tenant status: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    return (
      (await this.listTenantsForHost(input.hostId)).find(
        (tenant) => tenant.id === input.tenantId,
      ) ?? null
    );
  }

  async putSecretRecord(record: SecretRecord): Promise<void> {
    const { error } = await this.client.from("platform_secret_vault").upsert({
      ref: record.ref,
      tenant_id: record.tenantId ?? null,
      name: record.name,
      encrypted_value: record.encryptedValue,
      created_at: record.createdAt,
    });
    if (error) {
      throw new Error(`Could not save encrypted secret: ${error.message}`);
    }
  }

  async getSecretRecord(ref: string): Promise<SecretRecord | null> {
    const { data, error } = await this.client
      .from("platform_secret_vault")
      .select("*")
      .eq("ref", ref)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not load encrypted secret: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    return {
      ref: data.ref,
      ...(data.tenant_id ? { tenantId: data.tenant_id } : {}),
      name: data.name,
      encryptedValue: data.encrypted_value,
      createdAt: data.created_at,
    };
  }

  async deleteSecretRecord(ref: string): Promise<void> {
    const { error } = await this.client
      .from("platform_secret_vault")
      .delete()
      .eq("ref", ref);
    if (error) {
      throw new Error(`Could not delete encrypted secret: ${error.message}`);
    }
  }

  async consumeRateLimit(input: {
    key: string;
    limit: number;
    windowMs: number;
    now: number;
  }): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      "consume_platform_rate_limit",
      {
        p_key_hash: input.key,
        p_limit: input.limit,
        p_window_ms: input.windowMs,
        p_now: new Date(input.now).toISOString(),
      },
    );
    if (error) {
      throw new Error(`Could not apply platform rate limit: ${error.message}`);
    }

    return data;
  }
}

function customerOrderFromRow(row: {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: string;
  created_at: string;
  items: unknown;
  total: number;
  currency: string;
  item_count: number;
}): CustomerOrder {
  return CustomerOrderSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    status: row.status,
    createdAt: row.created_at,
    items: row.items,
    total: row.total,
    currency: row.currency,
    itemCount: row.item_count,
  });
}

function fromAdminRow(row: {
  id: string;
  email: string;
  password_hash: string;
  totp_secret_ciphertext: string;
  recovery_code_hashes: string[];
  created_at: string;
}): SuperAdminRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    totpSecretCiphertext: row.totp_secret_ciphertext,
    recoveryCodeHashes: row.recovery_code_hashes,
    createdAt: row.created_at,
  };
}
