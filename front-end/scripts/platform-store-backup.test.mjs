import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupPlatformStore,
  restorePlatformStore,
  verifyBackupEnvelope,
} from "./platform-store-backup.mjs";

function state(overrides = {}) {
  return {
    initialized: true,
    setupTokenHash: null,
    platformDomain: "platform.example.com",
    reservedSubdomains: [],
    platformSettings: {},
    superAdmins: [],
    hosts: [],
    hostOwners: [],
    tenants: [],
    tenantStaff: [],
    customerAccounts: [],
    customerOrders: [],
    auditEvents: [],
    secrets: [],
    rateLimits: {},
    ...overrides,
  };
}

test("creates and restores a valid platform-store backup", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "platform-store-backup-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "platform-store.json");
  const backupDirectory = join(directory, "backups");
  await writeFile(source, JSON.stringify(state()), "utf8");

  const backup = await backupPlatformStore({
    sourceFile: source,
    targetDirectory: backupDirectory,
    now: new Date("2026-11-18T12:00:00.000Z"),
  });
  const envelope = JSON.parse(await readFile(backup, "utf8"));
  assert.equal(verifyBackupEnvelope(envelope).initialized, true);

  await writeFile(
    source,
    JSON.stringify(state({ initialized: false })),
    "utf8",
  );
  await restorePlatformStore({
    sourceBackup: backup,
    targetFile: source,
    force: true,
  });
  assert.equal(JSON.parse(await readFile(source, "utf8")).initialized, true);
});

test("rejects restore without force", async () => {
  await assert.rejects(
    restorePlatformStore({
      sourceBackup: "missing.json",
      targetFile: "platform-store.json",
      force: false,
    }),
    /requires --force/,
  );
});
