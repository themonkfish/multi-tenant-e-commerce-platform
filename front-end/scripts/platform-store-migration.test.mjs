import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPlatformStoreImportPayload,
  buildSecretFreeMigrationExport,
  exportPlatformStoreMigration,
  importPlatformStore,
  preflightPlatformStoreMigration,
  reencryptEncryptedSecret,
  rollbackPlatformStore,
  verifyMigrationEnvelope,
} from "./platform-store-migration.mjs";

function state() {
  const hostId = "550e8400-e29b-41d4-a716-446655440010";
  const tenantId = "550e8400-e29b-41d4-a716-446655440000";
  return {
    initialized: true,
    platformDomain: "platform.example.com",
    reservedSubdomains: ["admin"],
    hosts: [{ id: hostId, name: "Host", status: "active" }],
    hostOwners: [{ id: "owner-host", hostId, passwordHash: "host-secret" }],
    tenants: [{ id: tenantId, hostId, name: "Tenant", status: "active" }],
    tenantOwners: [
      {
        id: "owner-tenant",
        tenantId,
        hostId,
        passwordHash: "tenant-secret",
      },
    ],
    tenantStaff: [
      {
        id: "staff",
        tenantId,
        hostId,
        passwordHash: "staff-secret",
      },
    ],
    customerAccounts: [
      {
        id: "customer",
        tenantId,
        passwordHash: "customer-secret",
      },
    ],
    customerOrders: [{ id: "ORD-1", tenantId, customerId: "customer" }],
    tenantDomainClaims: [],
    auditEvents: [],
    secrets: [],
  };
}

test("builds a secret-free migration export with scope counts", () => {
  const { envelope, counts } = buildSecretFreeMigrationExport(
    state(),
    new Date("2026-11-23T12:00:00.000Z"),
  );
  assert.equal(counts.hosts, 1);
  assert.equal(counts.tenants, 1);
  assert.equal(envelope.format, "platform-store-migration-export");
  assert.equal(envelope.sha256.length, 64);
  assert.equal(JSON.stringify(envelope).includes("host-secret"), false);
  assert.equal(JSON.stringify(envelope).includes("tenant-secret"), false);
  assert.equal(JSON.stringify(envelope).includes("ciphertext"), false);
});

test("rejects tenants whose parent host is missing", () => {
  const source = state();
  source.tenants[0].hostId = "550e8400-e29b-41d4-a716-446655440099";
  assert.throws(
    () => buildSecretFreeMigrationExport(source),
    /references missing host/,
  );
});

test("exports to a protected file and supports dry-run", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-migration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "platform-store.json");
  const destination = join(directory, "migration-export.json");
  await writeFile(source, JSON.stringify(state()), "utf8");

  const dryRun = await exportPlatformStoreMigration({
    sourceFile: source,
    dryRun: true,
  });
  assert.equal(dryRun.counts.hosts, 1);

  await exportPlatformStoreMigration({
    sourceFile: source,
    destinationFile: destination,
  });
  const envelope = JSON.parse(await readFile(destination, "utf8"));
  assert.equal(envelope.formatVersion, 1);
});

test("preflights and verifies a migration envelope", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-preflight-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "platform-store.json");
  const destination = join(directory, "migration-export.json");
  await writeFile(source, JSON.stringify(state()), "utf8");
  await exportPlatformStoreMigration({
    sourceFile: source,
    destinationFile: destination,
  });

  const preflight = await preflightPlatformStoreMigration({
    exportFile: destination,
  });
  assert.equal(preflight.verified, true);
  assert.equal(preflight.counts.hosts, 1);

  const envelope = JSON.parse(await readFile(destination, "utf8"));
  envelope.sha256 = "0".repeat(64);
  assert.throws(() => verifyMigrationEnvelope(envelope), /checksum mismatch/);
});

function encryptWithKey(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  });
}

test("reencrypts encrypted secrets and builds an import payload", () => {
  const sourceKey = "11".repeat(32);
  const targetKey = "22".repeat(32);
  const original = encryptWithKey("provider-secret", sourceKey);
  const reencrypted = reencryptEncryptedSecret({
    encryptedValue: original,
    sourceKey,
    targetKey,
  });
  assert.notEqual(reencrypted, original);

  const source = state();
  source.superAdmins = [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      email: "admin@example.com",
      passwordHash: "argon2-password",
      totpSecretCiphertext: encryptWithKey("totp-secret", sourceKey),
      recoveryCodeHashes: ["hash"],
      createdAt: "2026-11-23T12:00:00.000Z",
    },
  ];
  source.secrets = [
    {
      ref: "550e8400-e29b-41d4-a716-446655440002",
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      name: "provider-key",
      encryptedValue: original,
      createdAt: "2026-11-23T12:00:00.000Z",
    },
  ];

  const payload = buildPlatformStoreImportPayload({
    state: source,
    sourceKey,
    targetKey,
  });
  assert.equal(payload.super_admins.length, 1);
  assert.equal(payload.secrets.length, 1);
  assert.notEqual(
    payload.secrets[0].encrypted_value,
    original,
  );
  assert.notEqual(
    payload.super_admins[0].totp_secret_ciphertext,
    source.superAdmins[0].totpSecretCiphertext,
  );
});

test("imports atomically through the service-role RPC", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-import-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const sourceFile = join(directory, "platform-store.json");
  await writeFile(sourceFile, JSON.stringify(state()), "utf8");

  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = { name, args };
      return {
        data: { hosts: 1, tenants: 1, superAdmins: 0, secrets: 1, auditEvents: 0 },
        error: null,
      };
    },
  };

  const result = await importPlatformStore({
    sourceFile,
    sourceKey: "11".repeat(32),
    targetKey: "22".repeat(32),
    cutover: true,
    env: {
      PLATFORM_SUPABASE_SERVICE_KEY: "test-service-key",
    },
    supabaseClient: client,
  });
  assert.equal(result.cutover, true);
  assert.equal(rpcArgs.name, "import_platform_store");
  assert.equal(rpcArgs.args.p_cutover, true);
  assert.equal(rpcArgs.args.p_payload.hosts.length, 1);
});

test("rolls back through the service-role RPC", async () => {
  let rpcName;
  const client = {
    async rpc(name) {
      rpcName = name;
      return { data: true, error: null };
    },
  };
  const result = await rollbackPlatformStore({
    env: { PLATFORM_SUPABASE_SERVICE_KEY: "test-service-key" },
    supabaseClient: client,
  });
  assert.equal(result.rolledBack, true);
  assert.equal(rpcName, "rollback_platform_store");
});
