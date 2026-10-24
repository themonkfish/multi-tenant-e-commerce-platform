import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HostConfig } from "@/core/domain/host-config";
import { DEFAULT_PLATFORM_SETTINGS } from "@/core/domain/platform-settings";
import {
  TenantStoreSettingsSchema,
  type HostOwnerInvite,
  type TenantOwnerInvite,
  type TenantRecord,
  type TenantStoreSettings,
} from "@/core/domain/host-portal";
import type { AuditEvent, BootstrapInput } from "@/core/ports/platform-store";
import { resolveRequestScope } from "@/core/tenancy/request-scope";
import { hashToken } from "@/lib/server/crypto";
import { FilePlatformStore } from "./platform-store";

const temporaryDirectories: string[] = [];

async function createStore() {
  return (await createStoreWithPath()).store;
}

async function createStoreWithPath() {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-test-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "platform.json");
  return { store: new FilePlatformStore(filePath), filePath };
}

function bootstrapInput(token: string): BootstrapInput {
  return {
    setupTokenHash: hashToken(token),
    platformDomain: "platform.example.com",
    reservedSubdomains: ["admin", "www"],
    settings: {
      ...DEFAULT_PLATFORM_SETTINGS,
      name: "Example Commerce",
      primaryColor: "#123456",
      accentColor: "#654321",
      termsUrl: "https://platform.example.com/terms",
    },
    superAdmin: {
      id: "admin-1",
      email: "admin@example.com",
      passwordHash: "argon2id-hash",
      totpSecretCiphertext: "encrypted-totp",
      recoveryCodeHashes: [],
      createdAt: new Date().toISOString(),
    },
  };
}

function hostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const now = new Date().toISOString();
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    slug: "sample-host",
    name: "Sample Host",
    status: "pending",
    plan: "starter",
    limits: {
      maxTenants: 10,
      maxCustomDomains: 2,
      features: {},
    },
    branding: { name: "Sample Host" },
    domains: ["shop.example.com"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function hostAudit(action = "host.created"): AuditEvent {
  return {
    id: randomUUID(),
    actorId: "admin-1",
    scope: { kind: "platform" as const, id: "platform" },
    action,
    resourceType: "host",
    resourceId: "550e8400-e29b-41d4-a716-446655440000",
    createdAt: new Date().toISOString(),
  };
}

function hostScopedAudit(
  action: string,
  resourceType: string,
  resourceId: string,
): AuditEvent {
  return {
    id: randomUUID(),
    actorId: "host-owner",
    scope: { kind: "host", id: "550e8400-e29b-41d4-a716-446655440000" },
    action,
    resourceType,
    resourceId,
    createdAt: new Date().toISOString(),
  };
}

function tenantRecord(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hostId: "550e8400-e29b-41d4-a716-446655440000",
    slug: `tenant-${randomUUID().slice(0, 8)}`,
    name: "Sample Tenant",
    status: "pending",
    plan: "starter",
    domains: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FilePlatformStore", () => {
  it("allows a single bootstrap and permanently locks setup after completion", async () => {
    const store = await createStore();
    const input = bootstrapInput("one-time-token");

    expect(await store.getSetupState()).toEqual({
      initialized: false,
      reservedSubdomains: [],
      settings: DEFAULT_PLATFORM_SETTINGS,
    });
    await store.createInitialSuperAdmin(input);
    expect((await store.getSetupState()).settings).toEqual(input.settings);
    expect(
      await store.getBootstrapAdmin(input.setupTokenHash, "admin@example.com"),
    ).toMatchObject({ id: "admin-1" });
    expect(
      await store.getBootstrapAdmin(
        hashToken("wrong-token"),
        "admin@example.com",
      ),
    ).toBeNull();

    await store.completeBootstrap({
      setupTokenHash: input.setupTokenHash,
      email: "admin@example.com",
      recoveryCodeHashes: ["recovery-hash"],
      auditEvent: {
        id: "audit-1",
        actorId: "admin-1",
        scope: { kind: "platform", id: "platform" },
        action: "platform.bootstrap.completed",
        resourceType: "platform",
        createdAt: new Date().toISOString(),
      },
    });
    expect((await store.getSetupState()).initialized).toBe(true);
    expect(await store.getSuperAdminByEmail("ADMIN@example.com")).toMatchObject(
      { recoveryCodeHashes: ["recovery-hash"] },
    );
    await expect(store.createInitialSuperAdmin(input)).rejects.toThrow(
      "Platform setup has already been started",
    );
  });

  it("consumes each recovery code only once", async () => {
    const store = await createStore();
    const input = bootstrapInput("one-time-token");
    input.superAdmin.recoveryCodeHashes = ["recovery-hash"];
    await store.createInitialSuperAdmin(input);

    expect(await store.consumeRecoveryCode("admin-1", "recovery-hash")).toBe(
      true,
    );
    expect(await store.consumeRecoveryCode("admin-1", "recovery-hash")).toBe(
      false,
    );
  });

  it("enforces rate limits and opens a new window after expiry", async () => {
    const store = await createStore();
    const first = { key: "client-hash", limit: 2, windowMs: 1000, now: 100 };

    expect(await store.consumeRateLimit(first)).toBe(true);
    expect(await store.consumeRateLimit(first)).toBe(true);
    expect(await store.consumeRateLimit(first)).toBe(false);
    expect(await store.consumeRateLimit({ ...first, now: 1100 })).toBe(true);
  });

  it("stores vault values only as ciphertext", async () => {
    process.env.PLATFORM_SECRET_KEY = "ab".repeat(32);
    const store = await createStore();
    const plaintext = "do-not-persist-this-value";
    const vault = new (await import("./secret-vault")).EncryptedSecretVault(
      store,
    );
    const ref = await vault.putSecret({
      tenantId: "tenant-1",
      name: "backend-api-key",
      value: plaintext,
    });
    const stored = await readFile(
      join(temporaryDirectories[0], "platform.json"),
      "utf8",
    );

    expect(stored).not.toContain(plaintext);
    expect(await vault.getSecret(ref)).toBe(plaintext);
    await vault.deleteSecret(ref);
    await expect(vault.getSecret(ref)).rejects.toThrow("was not found");
  });

  it("creates hosts, rejects duplicate slugs or domains, and audits status changes", async () => {
    const store = await createStore();
    const host = hostConfig();

    await store.createHost(host, hostAudit());
    expect(await store.listHosts()).toEqual([host]);
    await expect(store.getHostById(host.id)).resolves.toEqual(host);
    await expect(store.getHostByDomain("shop.example.com")).resolves.toEqual(
      host,
    );
    await expect(store.getHostById("unknown-host")).resolves.toBeNull();
    await expect(
      store.getHostByDomain("unknown.example.com"),
    ).resolves.toBeNull();
    await expect(
      store.createHost(
        hostConfig({ id: "550e8400-e29b-41d4-a716-446655440001" }),
        hostAudit(),
      ),
    ).rejects.toThrow("A host with this slug already exists");
    await expect(
      store.createHost(
        hostConfig({
          id: "550e8400-e29b-41d4-a716-446655440002",
          slug: "other-host",
        }),
        hostAudit(),
      ),
    ).rejects.toThrow("A host with one of these domains already exists");

    const updatedAt = new Date().toISOString();
    const updated = await store.updateHostStatus(
      host.id,
      "suspended",
      updatedAt,
      hostAudit("host.suspended"),
    );
    expect(updated).toMatchObject({ id: host.id, status: "suspended" });
    expect(await store.listHosts()).toEqual([updated]);
    expect(
      await store.updateHostStatus(
        "550e8400-e29b-41d4-a716-446655440099",
        "active",
        updatedAt,
        hostAudit("host.activated"),
      ),
    ).toBeNull();

    const persisted = JSON.parse(
      await readFile(join(temporaryDirectories[0], "platform.json"), "utf8"),
    ) as { auditEvents: Array<{ action: string }> };
    expect(persisted.auditEvents.map((event) => event.action)).toEqual([
      "host.created",
      "host.suspended",
    ]);
  });

  it("reads existing platform store files that predate host records", async () => {
    const store = await createStore();
    await writeFile(
      join(temporaryDirectories[0], "platform.json"),
      JSON.stringify({
        initialized: true,
        setupTokenHash: null,
        platformDomain: "platform.example.com",
        reservedSubdomains: ["admin", "www"],
        superAdmins: [],
        auditEvents: [],
        secrets: [],
        rateLimits: {},
      }),
    );

    expect(await store.listHosts()).toEqual([]);
    expect(await store.getSetupState()).toMatchObject({
      initialized: true,
      platformDomain: "platform.example.com",
    });
  });

  it("accepts a host-owner invitation once and rejects it after expiration", async () => {
    const store = await createStore();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const now = new Date();
    const invite: HostOwnerInvite = {
      id: randomUUID(),
      hostId: host.id,
      email: "owner@example.com",
      tokenHash: hashToken("one-time-invitation-token"),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      createdAt: now.toISOString(),
    };
    await store.createHostOwnerInvite(invite, hostAudit("host.owner_invited"));

    expect(
      await store.getHostOwnerInvite(invite.tokenHash, now.toISOString()),
    ).toEqual(invite);
    const accepted = await store.acceptHostOwnerInvite({
      tokenHash: invite.tokenHash,
      passwordHash: "argon2id-hash",
      now: now.toISOString(),
      auditEvent: hostScopedAudit(
        "host.owner_invite.accepted",
        "host_owner",
        invite.id,
      ),
    });
    expect(accepted).toMatchObject({
      hostId: host.id,
      email: invite.email,
      passwordHash: "argon2id-hash",
    });
    await expect(
      store.acceptHostOwnerInvite({
        tokenHash: invite.tokenHash,
        passwordHash: "another-hash",
        now: now.toISOString(),
        auditEvent: hostScopedAudit(
          "host.owner_invite.accepted",
          "host_owner",
          invite.id,
        ),
      }),
    ).resolves.toBeNull();

    const expiredInvite = {
      ...invite,
      id: randomUUID(),
      email: "expired@example.com",
      tokenHash: hashToken("expired-invitation-token"),
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    };
    await store.createHostOwnerInvite(
      expiredInvite,
      hostAudit("host.owner_invited"),
    );
    expect(
      await store.getHostOwnerInvite(
        expiredInvite.tokenHash,
        now.toISOString(),
      ),
    ).toBeNull();
  });

  it("enforces host tenant/domain limits and tenant ownership on status changes", async () => {
    const store = await createStore();
    const host = hostConfig({
      status: "active",
      limits: {
        maxTenants: 10,
        maxCustomDomains: 2,
        features: {},
      },
    });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ domains: ["store.example.net"] });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );

    const overDomainLimit = tenantRecord({
      domains: ["second.example.net"],
    });
    await expect(
      store.createTenantForHost(
        overDomainLimit,
        hostScopedAudit("tenant.created", "tenant", overDomainLimit.id),
      ),
    ).rejects.toThrow("Host custom-domain limit reached");
    const duplicateHostDomain = tenantRecord({
      domains: [host.domains[0]],
    });
    await expect(
      store.createTenantForHost(
        duplicateHostDomain,
        hostScopedAudit("tenant.created", "tenant", duplicateHostDomain.id),
      ),
    ).rejects.toThrow("A tenant with one of these domains already exists");

    await expect(
      store.updateTenantStatus({
        hostId: "550e8400-e29b-41d4-a716-446655440099",
        tenantId: tenant.id,
        status: "active",
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit("tenant.activated", "tenant", tenant.id),
      }),
    ).resolves.toBeNull();
    await expect(store.listTenantsForHost(host.id)).resolves.toEqual([tenant]);
    await expect(store.getTenantByDomain(tenant.domains[0])).resolves.toEqual(
      tenant,
    );
    await expect(
      store.getTenantByDomain("unknown.example.com"),
    ).resolves.toBeNull();
  });

  it("routes tenant domains only after a matching domain claim is completed", async () => {
    const store = await createStore();
    const host = hostConfig({
      status: "active",
      limits: { maxTenants: 10, maxCustomDomains: 4, features: {} },
    });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    const domain = "store.example.net";
    const token = "a".repeat(64);
    const createdAt = new Date().toISOString();
    const claim = await store.createTenantDomainClaim({
      hostId: host.id,
      tenantId: tenant.id,
      domain,
      verificationToken: token,
      createdAt,
      auditEvent: hostScopedAudit(
        "tenant.domain_verification_started",
        "tenant_domain",
        domain,
      ),
    });

    expect(claim).toEqual({
      hostId: host.id,
      tenantId: tenant.id,
      domain,
      verificationToken: token,
      createdAt,
    });
    await expect(store.getTenantByDomain(domain)).resolves.toBeNull();
    await expect(store.listTenantDomainClaims(host.id)).resolves.toEqual([
      claim,
    ]);
    await expect(
      store.completeTenantDomainClaim({
        hostId: host.id,
        tenantId: tenant.id,
        domain,
        verificationToken: "wrong-token",
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.domain_verified",
          "tenant_domain",
          domain,
        ),
      }),
    ).resolves.toBeNull();
    const completed = await store.completeTenantDomainClaim({
      hostId: host.id,
      tenantId: tenant.id,
      domain,
      verificationToken: token,
      updatedAt: new Date().toISOString(),
      auditEvent: hostScopedAudit(
        "tenant.domain_verified",
        "tenant_domain",
        domain,
      ),
    });

    expect(completed?.domains).toContain(domain);
    await expect(store.getTenantByDomain(domain)).resolves.toEqual(completed);
    await expect(store.listTenantDomainClaims(host.id)).resolves.toEqual([]);
    await expect(
      resolveRequestScope(domain, {
        getSetupState: async () => ({
          initialized: true,
          platformDomain: "platform.example.com",
          reservedSubdomains: [],
          settings: DEFAULT_PLATFORM_SETTINGS,
        }),
        getTenantByDomain: store.getTenantByDomain.bind(store),
        getHostById: store.getHostById.bind(store),
        getHostByDomain: store.getHostByDomain.bind(store),
      }),
    ).resolves.toMatchObject({
      kind: "tenant",
      domain,
      tenant: { id: tenant.id },
      scope: { kind: "tenant", id: tenant.id, hostId: host.id },
    });
  });

  it("accepts a tenant-owner invitation once and enforces tenant scope", async () => {
    const store = await createStore();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    const pendingTenant = tenantRecord({ status: "pending" });
    await store.createTenantForHost(
      pendingTenant,
      hostScopedAudit("tenant.created", "tenant", pendingTenant.id),
    );
    const now = new Date();
    const invite: TenantOwnerInvite = {
      id: randomUUID(),
      tenantId: tenant.id,
      hostId: host.id,
      email: "store-owner@example.com",
      tokenHash: hashToken("tenant-owner-invitation-token"),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      createdAt: now.toISOString(),
    };
    await expect(
      store.createTenantOwnerInvite(
        { ...invite, tenantId: pendingTenant.id },
        hostScopedAudit(
          "tenant.owner_invited",
          "tenant_owner_invite",
          invite.id,
        ),
      ),
    ).rejects.toThrow("Only active tenants");
    await store.createTenantOwnerInvite(
      invite,
      hostScopedAudit("tenant.owner_invited", "tenant_owner_invite", invite.id),
    );
    const supersededInvite: TenantOwnerInvite = {
      ...invite,
      id: randomUUID(),
      email: "another-owner@example.com",
      tokenHash: hashToken("superseded-tenant-owner-invitation"),
    };
    await store.createTenantOwnerInvite(
      supersededInvite,
      hostScopedAudit(
        "tenant.owner_invited",
        "tenant_owner_invite",
        supersededInvite.id,
      ),
    );

    expect(
      await store.getTenantOwnerInvite(
        supersededInvite.tokenHash,
        now.toISOString(),
      ),
    ).toEqual(supersededInvite);
    const owner = await store.acceptTenantOwnerInvite({
      tokenHash: supersededInvite.tokenHash,
      passwordHash: "argon2id-password-hash",
      now: now.toISOString(),
      auditEvent: {
        id: randomUUID(),
        actorId: invite.email,
        scope: { kind: "tenant", id: tenant.id, hostId: host.id },
        action: "tenant.owner_invite.accepted",
        resourceType: "tenant_owner",
        createdAt: now.toISOString(),
      },
    });
    expect(owner).toMatchObject({
      tenantId: tenant.id,
      hostId: host.id,
      email: supersededInvite.email,
    });
    if (!owner) {
      throw new Error("Expected tenant owner invitation to be accepted");
    }
    await expect(
      store.getTenantOwnerForTenant(
        owner.id,
        "550e8400-e29b-41d4-a716-446655440099",
      ),
    ).resolves.toBeNull();
    await expect(
      store.getTenantOwnerByEmail(invite.email.toUpperCase()),
    ).resolves.toBeNull();
    await expect(
      store.getTenantOwnerByEmail(supersededInvite.email.toUpperCase()),
    ).resolves.toMatchObject({ id: owner.id });
    await expect(
      store.getTenantOwnerByTenant(tenant.id),
    ).resolves.toMatchObject({
      id: owner.id,
    });
    await expect(
      store.getTenantOwnerInvite(invite.tokenHash, now.toISOString()),
    ).resolves.toBeNull();
    const duplicateInvite: TenantOwnerInvite = {
      ...invite,
      id: randomUUID(),
      email: "new-owner@example.com",
      tokenHash: hashToken("another-tenant-owner-invitation"),
    };
    await expect(
      store.createTenantOwnerInvite(
        duplicateInvite,
        hostScopedAudit(
          "tenant.owner_invited",
          "tenant_owner_invite",
          duplicateInvite.id,
        ),
      ),
    ).rejects.toThrow("already has a tenant owner");
    await expect(
      store.acceptTenantOwnerInvite({
        tokenHash: supersededInvite.tokenHash,
        passwordHash: "another-hash",
        now: now.toISOString(),
        auditEvent: {
          id: randomUUID(),
          actorId: invite.email,
          scope: { kind: "tenant", id: tenant.id, hostId: host.id },
          action: "tenant.owner_invite.accepted",
          resourceType: "tenant_owner",
          createdAt: now.toISOString(),
        },
      }),
    ).resolves.toBeNull();
  });

  it("persists tenant brand and locale settings only within active tenant scope", async () => {
    const store = await createStore();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    const defaults = await store.getTenantStoreSettings(
      tenant.id,
      host.id,
      tenant.name,
    );
    expect(defaults.branding.name).toBe(tenant.name);

    const settings: TenantStoreSettings = {
      branding: {
        name: "My Shop",
        description: "A small storefront",
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#123456",
        accentColor: "#654321",
      },
      locale: {
        defaultLocale: "en-GB",
        locales: ["en-GB", "fr-CA"],
        currency: "GBP",
        currencies: ["GBP", "EUR"],
      },
    };
    await expect(
      store.updateTenantStoreSettings({
        tenantId: tenant.id,
        hostId: "550e8400-e29b-41d4-a716-446655440099",
        settings,
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.settings.updated",
          "tenant_settings",
          tenant.id,
        ),
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateTenantStoreSettings({
        tenantId: tenant.id,
        hostId: host.id,
        settings,
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.settings.updated",
          "tenant_settings",
          tenant.id,
        ),
      }),
    ).resolves.toEqual(settings);
    await expect(
      store.getTenantStoreSettings(tenant.id, host.id, tenant.name),
    ).resolves.toEqual(settings);
    expect(
      TenantStoreSettingsSchema.safeParse({
        ...settings,
        branding: {
          ...settings.branding,
          logoUrl: "http://insecure.example.com/logo.png",
        },
      }).success,
    ).toBe(false);
    expect(
      TenantStoreSettingsSchema.safeParse({
        ...settings,
        locale: {
          ...settings.locale,
          currency: "USD",
          currencies: ["GBP", "EUR"],
        },
      }).success,
    ).toBe(false);
  });

  it("persists REST connection settings only for an active tenant in its host", async () => {
    const store = await createStore();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    const config = {
      type: "rest" as const,
      baseUrl: "https://api.example.com",
      apiVersion: "v1",
      authMode: "apiKey" as const,
      apiKeyRef: randomUUID(),
    };

    await expect(
      store.updateTenantRestConnection({
        tenantId: tenant.id,
        hostId: "550e8400-e29b-41d4-a716-446655440099",
        config,
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.rest_connection.updated",
          "tenant_rest_connection",
          tenant.id,
        ),
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateTenantRestConnection({
        tenantId: tenant.id,
        hostId: host.id,
        config,
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.rest_connection.updated",
          "tenant_rest_connection",
          tenant.id,
        ),
      }),
    ).resolves.toEqual(config);
    await expect(
      store.getTenantRestConnection(tenant.id, host.id),
    ).resolves.toEqual(config);
  });

  it("persists encrypted database-provider references within the tenant host scope", async () => {
    const store = await createStore();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    const secretRef = randomUUID();
    await store.putSecretRecord({
      ref: secretRef,
      tenantId: tenant.id,
      name: "tenant-supabase-service-key",
      encryptedValue: "encrypted-value",
      createdAt: new Date().toISOString(),
    });
    const config = {
      type: "supabase" as const,
      projectUrl: "https://tenant-project.supabase.co",
      serviceKeyRef: secretRef,
      schema: "public" as const,
      tenancyMode: "dedicated-project" as const,
    };
    const auditEvent = hostScopedAudit(
      "tenant.database_provider.updated",
      "tenant_database_provider",
      tenant.id,
    );

    await expect(
      store.updateTenantDatabaseProvider({
        tenantId: tenant.id,
        hostId: "550e8400-e29b-41d4-a716-446655440099",
        config,
        updatedAt: new Date().toISOString(),
        auditEvent,
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateTenantDatabaseProvider({
        tenantId: tenant.id,
        hostId: host.id,
        config,
        updatedAt: new Date().toISOString(),
        auditEvent,
      }),
    ).resolves.toEqual(config);
    await expect(
      store.getTenantDatabaseProvider(tenant.id, host.id),
    ).resolves.toEqual(config);
    await expect(
      store.deleteTenantDatabaseProvider({
        tenantId: tenant.id,
        hostId: host.id,
        updatedAt: new Date().toISOString(),
        auditEvent: hostScopedAudit(
          "tenant.database_provider.deleted",
          "tenant_database_provider",
          tenant.id,
        ),
      }),
    ).resolves.toBe(true);
    await expect(
      store.getTenantDatabaseProvider(tenant.id, host.id),
    ).resolves.toBeNull();
  });

  it("scopes Staff creation and customer order reads to their tenant and account", async () => {
    const { store, filePath } = await createStoreWithPath();
    const host = hostConfig({ status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ hostId: host.id, status: "active" });
    const otherTenant = tenantRecord({
      hostId: host.id,
      status: "active",
      domains: ["other.example.com"],
    });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenant.id),
    );
    await store.createTenantForHost(
      otherTenant,
      hostScopedAudit("tenant.created", "tenant", otherTenant.id),
    );

    const staff = await store.createTenantStaff({
      id: randomUUID(),
      tenantId: tenant.id,
      hostId: host.id,
      email: " STAFF@EXAMPLE.COM ",
      passwordHash: "staff-hash",
      permissions: ["catalog:read", "catalog:write"],
      createdAt: new Date().toISOString(),
    });
    expect(staff.email).toBe("staff@example.com");
    expect(await store.listTenantStaff(tenant.id)).toEqual([
      expect.objectContaining({
        id: staff.id,
        email: "staff@example.com",
        permissions: ["catalog:read", "catalog:write"],
      }),
    ]);
    expect(await store.listTenantStaff(otherTenant.id)).toEqual([]);
    await expect(
      store.updateTenantStaff({
        staffId: staff.id,
        tenantId: otherTenant.id,
        active: false,
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateTenantStaff({
        staffId: staff.id,
        tenantId: tenant.id,
        active: false,
      }),
    ).resolves.toMatchObject({ id: staff.id, active: false });
    expect(
      await store.getTenantStaffByEmail(tenant.id, "staff@example.com"),
    ).toBeNull();
    await expect(
      store.updateTenantStaff({
        staffId: staff.id,
        tenantId: tenant.id,
        active: true,
        passwordHash: "reset-hash",
      }),
    ).resolves.toMatchObject({
      id: staff.id,
      active: true,
      passwordHash: "reset-hash",
    });
    expect(
      await store.getTenantStaffByEmail(tenant.id, "staff@example.com"),
    ).toMatchObject({ id: staff.id, passwordHash: "reset-hash", active: true });
    await expect(
      store.createTenantStaff({
        id: randomUUID(),
        tenantId: tenant.id,
        hostId: host.id,
        email: "staff@example.com",
        passwordHash: "another-hash",
        permissions: ["catalog:read"],
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("An account with this email already exists");

    const customer = await store.createCustomerAccount({
      id: randomUUID(),
      tenantId: tenant.id,
      email: "customer@example.com",
      passwordHash: "customer-hash",
      createdAt: new Date().toISOString(),
    });
    const otherCustomer = await store.createCustomerAccount({
      id: randomUUID(),
      tenantId: tenant.id,
      email: "other@example.com",
      passwordHash: "other-hash",
      createdAt: new Date().toISOString(),
    });
    const otherTenantCustomer = await store.createCustomerAccount({
      id: randomUUID(),
      tenantId: otherTenant.id,
      email: "customer@example.com",
      passwordHash: "other-tenant-hash",
      createdAt: new Date().toISOString(),
    });
    const order = {
      id: "ORDER-IDEMPOTENT-001",
      tenantId: tenant.id,
      customerId: customer.id,
      status: "Confirmed" as const,
      createdAt: new Date().toISOString(),
      items: [
        {
          productId: "catalog-product-1",
          title: "Sample product",
          slug: "sample-product",
          quantity: 2,
          unitPrice: 1250,
          currency: "USD",
        },
      ],
      total: 2500,
      currency: "USD",
      itemCount: 2,
      paymentMethod: "stripe" as const,
      paymentStatus: "pending" as const,
      paymentAttempt: 0,
      backendSyncStatus: "not_configured" as const,
    };
    await expect(store.createCustomerOrder(order)).resolves.toEqual({
      order,
      created: true,
    });
    await expect(
      store.createCustomerOrder({ ...order, total: 1 }),
    ).resolves.toEqual({ order, created: false });
    await expect(
      store.createCustomerOrder({
        ...order,
        customerId: otherCustomer.id,
      }),
    ).rejects.toThrow("already used by another customer");
    await expect(
      store.getCustomerOrder(tenant.id, customer.id, order.id),
    ).resolves.toEqual(order);
    await expect(
      store.getCustomerOrder(otherTenant.id, customer.id, order.id),
    ).resolves.toBeNull();
    const prepared = await store.prepareCustomerOrderPayment({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
    });
    expect(prepared).toMatchObject({
      attempt: 1,
      order: { ...order, paymentAttempt: 1 },
    });
    await expect(
      store.prepareCustomerOrderPayment({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
      }),
    ).resolves.toEqual(prepared);
    await expect(
      store.saveCustomerOrderPaymentSession({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        attempt: 1,
        sessionId: "cs_test_first",
      }),
    ).resolves.toMatchObject({ paymentSessionId: "cs_test_first" });
    await expect(
      store.updateCustomerOrderPayment({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sessionId: "cs_test_stale",
        status: "paid",
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateCustomerOrderPayment({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sessionId: "cs_test_first",
        status: "failed",
      }),
    ).resolves.toMatchObject({ paymentStatus: "failed" });
    const retried = await store.prepareCustomerOrderPayment({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
    });
    expect(retried?.attempt).toBe(2);
    await store.saveCustomerOrderPaymentSession({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
      attempt: 2,
      sessionId: "cs_test_second",
    });
    await expect(
      store.updateCustomerOrderPayment({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sessionId: "cs_test_first",
        status: "paid",
      }),
    ).resolves.toBeNull();
    await expect(
      store.updateCustomerOrderPayment({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sessionId: "cs_test_second",
        status: "paid",
        paymentIntentId: "pi_test_paid",
      }),
    ).resolves.toMatchObject({
      paymentStatus: "paid",
      paymentIntentId: "pi_test_paid",
      paymentAttempt: 2,
    });
    await expect(
      store.listCustomerOrders(tenant.id, customer.id),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          paymentStatus: "paid",
          paymentAttempt: 2,
          paymentSessionId: "cs_test_second",
          paymentIntentId: "pi_test_paid",
        }),
      ]),
    );
    await expect(
      store.updateCustomerOrderSync({
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        status: "failed",
        error: "Tenant backend is unavailable.",
      }),
    ).resolves.toMatchObject({
      id: order.id,
      backendSyncStatus: "failed",
      backendSyncError: "Tenant backend is unavailable.",
    });
    await expect(
      store.updateCustomerOrderStatus({
        tenantId: tenant.id,
        orderId: order.id,
        status: "Processing",
      }),
    ).resolves.toMatchObject({ id: order.id, status: "Processing" });
    await expect(
      store.listCustomerOrders(tenant.id, customer.id),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          status: "Processing",
        }),
      ]),
    );
    await expect(
      store.updateCustomerOrderSync({
        tenantId: tenant.id,
        customerId: otherCustomer.id,
        orderId: order.id,
        status: "synced",
      }),
    ).resolves.toBeNull();

    const state = JSON.parse(await readFile(filePath, "utf8"));
    const createdAt = new Date().toISOString();
    state.customerOrders.push(
      {
        id: "ORDER-CUSTOMER-1",
        tenantId: tenant.id,
        customerId: customer.id,
        status: "Confirmed",
        createdAt,
        total: 2400,
        currency: "USD",
        itemCount: 1,
      },
      {
        id: "ORDER-CUSTOMER-2",
        tenantId: tenant.id,
        customerId: otherCustomer.id,
        status: "Processing",
        createdAt,
        total: 3200,
        currency: "USD",
        itemCount: 1,
      },
      {
        id: "ORDER-OTHER-TENANT",
        tenantId: otherTenant.id,
        customerId: otherTenantCustomer.id,
        status: "Shipped",
        createdAt,
        total: 4100,
        currency: "USD",
        itemCount: 2,
      },
    );
    await writeFile(filePath, JSON.stringify(state));

    await expect(
      store.listCustomerOrders(tenant.id, customer.id),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ORDER-CUSTOMER-1",
          tenantId: tenant.id,
          customerId: customer.id,
        }),
        expect.objectContaining({
          id: "ORDER-IDEMPOTENT-001",
          tenantId: tenant.id,
          customerId: customer.id,
        }),
      ]),
    );
    await expect(
      store.listCustomerOrders(otherTenant.id, customer.id),
    ).resolves.toEqual([]);
  });

  it("lists pending cash-on-delivery orders and records collection once", async () => {
    const { store, filePath } = await createStoreWithPath();
    const tenantId = "550e8400-e29b-41d4-a716-446655440010";
    const hostId = "550e8400-e29b-41d4-a716-446655440000";
    const customerId = "550e8400-e29b-41d4-a716-446655440011";
    const host = hostConfig({ id: hostId, status: "active" });
    await store.createHost(host, hostAudit());
    const tenant = tenantRecord({ id: tenantId, hostId, status: "active" });
    await store.createTenantForHost(
      tenant,
      hostScopedAudit("tenant.created", "tenant", tenantId),
    );
    await store.createCustomerAccount({
      id: customerId,
      tenantId,
      email: "cod-customer@example.com",
      passwordHash: "customer-hash",
      createdAt: new Date().toISOString(),
    });
    const order = {
      id: "ORD-550e8400-e29b-41d4-a716-446655440012",
      tenantId,
      customerId,
      status: "Confirmed" as const,
      createdAt: new Date().toISOString(),
      items: [
        {
          productId: "product-1",
          title: "Cotton shirt",
          slug: "cotton-shirt",
          quantity: 1,
          unitPrice: 1500,
          currency: "INR",
        },
      ],
      total: 1500,
      currency: "INR",
      itemCount: 1,
      paymentMethod: "cash_on_delivery" as const,
      paymentStatus: "cod_due" as const,
      paymentAttempt: 0,
      deliveryAddress: {
        fullName: "Test Customer",
        line1: "1 Market Road",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "IN" as const,
        phone: "+919876543210",
      },
      backendSyncStatus: "synced" as const,
    };
    await store.createCustomerOrder(order);
    await expect(
      store.prepareCustomerOrderPayment({
        tenantId,
        customerId,
        orderId: order.id,
      }),
    ).resolves.toBeNull();
    await expect(
      store.listTenantCashOnDeliveryOrders({
        tenantId,
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      data: [
        expect.objectContaining({ id: order.id, paymentStatus: "cod_due" }),
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });

    const auditEvent: AuditEvent = {
      id: randomUUID(),
      actorId: "tenant-operator",
      scope: { kind: "tenant", id: tenantId, hostId },
      action: "tenant.order.cash_on_delivery_collected",
      resourceType: "customer_order_payment",
      resourceId: order.id,
      createdAt: new Date().toISOString(),
    };
    await expect(
      store.markCustomerOrderCashOnDeliveryCollected({
        tenantId,
        orderId: order.id,
        auditEvent,
      }),
    ).resolves.toMatchObject({ id: order.id, paymentStatus: "paid" });
    await expect(
      store.markCustomerOrderCashOnDeliveryCollected({
        tenantId,
        orderId: order.id,
        auditEvent: { ...auditEvent, id: randomUUID() },
      }),
    ).resolves.toBeNull();
    await expect(
      store.listTenantCashOnDeliveryOrders({
        tenantId,
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({ data: [], meta: { total: 0 } });

    const state = JSON.parse(await readFile(filePath, "utf8"));
    expect(state.auditEvents).toContainEqual(auditEvent);
  });
});
