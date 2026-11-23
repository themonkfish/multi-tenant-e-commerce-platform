import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSecretFreeMigrationExport,
  exportPlatformStoreMigration,
  preflightPlatformStoreMigration,
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
    secrets: [{ ref: "secret-ref", tenantId, ciphertext: "ciphertext" }],
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
