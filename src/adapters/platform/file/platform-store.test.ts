import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HostConfig } from "@/core/domain/host-config";
import type { AuditEvent, BootstrapInput } from "@/core/ports/platform-store";
import { hashToken } from "@/lib/server/crypto";
import { FilePlatformStore } from "./platform-store";

const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-test-"));
  temporaryDirectories.push(directory);
  return new FilePlatformStore(join(directory, "platform.json"));
}

function bootstrapInput(token: string): BootstrapInput {
  return {
    setupTokenHash: hashToken(token),
    platformDomain: "platform.example.com",
    reservedSubdomains: ["admin", "www"],
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
    });
    await store.createInitialSuperAdmin(input);
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
});
