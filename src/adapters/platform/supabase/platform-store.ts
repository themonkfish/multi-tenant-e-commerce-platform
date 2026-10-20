import "server-only";
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
