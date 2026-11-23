import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateMigrationState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Migration source is not a platform state object");
  }
  const requiredArrays = ["hosts", "tenants"];
  for (const field of requiredArrays) {
    if (!(field in state) || !Array.isArray(state[field])) {
      throw new Error(`Migration source is missing array field: ${field}`);
    }
  }
  const optionalArrays = [
    "hostOwners",
    "tenantOwners",
    "tenantStaff",
    "customerAccounts",
    "customerOrders",
    "auditEvents",
    "secrets",
    "tenantDomainClaims",
  ];
  for (const field of optionalArrays) {
    if (state[field] === undefined) state[field] = [];
    if (!Array.isArray(state[field])) {
      throw new Error(`Migration source has invalid ${field}`);
    }
  }
  return state;
}

export function buildSecretFreeMigrationExport(state, now = new Date()) {
  const source = validateMigrationState(state);
  const hostIds = new Set(source.hosts.map((host) => host.id));
  const tenantIds = new Set(source.tenants.map((tenant) => tenant.id));

  for (const tenant of source.tenants) {
    if (!hostIds.has(tenant.hostId)) {
      throw new Error(
        `Tenant ${tenant.id} references missing host ${tenant.hostId}`,
      );
    }
  }
  for (const owner of source.hostOwners) {
    if (!hostIds.has(owner.hostId)) {
      throw new Error(
        `Host owner ${owner.id} references missing host ${owner.hostId}`,
      );
    }
  }
  for (const owner of source.tenantOwners) {
    if (!tenantIds.has(owner.tenantId)) {
      throw new Error(
        `Tenant owner ${owner.id} references missing tenant ${owner.tenantId}`,
      );
    }
  }

  const counts = {
    hosts: source.hosts.length,
    hostOwners: source.hostOwners.length,
    tenants: source.tenants.length,
    tenantOwners: source.tenantOwners.length,
    tenantStaff: source.tenantStaff.length,
    customerAccounts: source.customerAccounts.length,
    customerOrders: source.customerOrders.length,
    auditEvents: source.auditEvents.length,
    domainClaims: (source.tenantDomainClaims ?? []).length,
  };
  const exportData = {
    format: "platform-store-migration-export",
    formatVersion: 1,
    createdAt: now.toISOString(),
    exportId: randomUUID(),
    platformDomain: source.platformDomain ?? null,
    reservedSubdomains: source.reservedSubdomains ?? [],
    hosts: source.hosts,
    hostOwners: source.hostOwners.map(({ passwordHash, ...owner }) => owner),
    tenants: source.tenants,
    tenantOwners: source.tenantOwners.map(
      ({ passwordHash, inviteTokenHash, ...owner }) => owner,
    ),
    tenantStaff: source.tenantStaff.map(({ passwordHash, ...staff }) => staff),
    customerAccounts: source.customerAccounts.map(
      ({ passwordHash, ...account }) => account,
    ),
    customerOrders: source.customerOrders,
    tenantDomainClaims: source.tenantDomainClaims ?? [],
    auditEvents: source.auditEvents,
  };
  const json = JSON.stringify(exportData);
  return {
    envelope: {
      ...exportData,
      sha256: createHash("sha256").update(json).digest("hex"),
    },
    counts,
  };
}

export async function exportPlatformStoreMigration({
  sourceFile,
  destinationFile,
  dryRun = false,
  now = new Date(),
}) {
  const source = JSON.parse(await readFile(resolve(sourceFile), "utf8"));
  const result = buildSecretFreeMigrationExport(source, now);
  if (!dryRun && destinationFile) {
    await writeFile(
      resolve(destinationFile),
      `${JSON.stringify(result.envelope, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  return result;
}

function containsExcludedSecretFields(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(containsExcludedSecretFields);
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      /passwordHash|password_hash|inviteTokenHash|token_hash|encryptedValue|encrypted_value|ciphertext|totpSecret/i.test(
        key,
      )
    ) {
      return true;
    }
    if (containsExcludedSecretFields(child)) return true;
  }
  return false;
}

export function verifyMigrationEnvelope(envelope) {
  if (
    !envelope ||
    envelope.format !== "platform-store-migration-export" ||
    envelope.formatVersion !== 1
  ) {
    throw new Error("Unsupported platform migration export format");
  }
  if (typeof envelope.sha256 !== "string") {
    throw new Error("Migration export checksum is missing");
  }
  if (containsExcludedSecretFields(envelope)) {
    throw new Error(
      "Migration export contains excluded credentials or encrypted secrets",
    );
  }
  const { sha256, ...exportData } = envelope;
  const actual = createHash("sha256")
    .update(JSON.stringify(exportData))
    .digest("hex");
  if (sha256 !== actual) {
    throw new Error("Migration export checksum mismatch");
  }

  const hostIds = new Set(envelope.hosts.map((host) => host.id));
  const tenantIds = new Set(envelope.tenants.map((tenant) => tenant.id));
  for (const tenant of envelope.tenants) {
    if (!hostIds.has(tenant.hostId)) {
      throw new Error(
        `Tenant ${tenant.id} references missing host ${tenant.hostId}`,
      );
    }
  }
  for (const owner of envelope.hostOwners ?? []) {
    if (!hostIds.has(owner.hostId)) {
      throw new Error(
        `Host owner ${owner.id} references missing host ${owner.hostId}`,
      );
    }
  }
  for (const owner of envelope.tenantOwners ?? []) {
    if (!tenantIds.has(owner.tenantId)) {
      throw new Error(
        `Tenant owner ${owner.id} references missing tenant ${owner.tenantId}`,
      );
    }
  }
  const domains = [
    ...envelope.hosts.flatMap((host) => host.domains ?? []),
    ...envelope.tenants.flatMap((tenant) => tenant.domains ?? []),
    ...(envelope.tenantDomainClaims ?? []).map((claim) => claim.domain),
  ].map((domain) => String(domain).toLowerCase());
  if (new Set(domains).size !== domains.length) {
    throw new Error("Migration export contains duplicate domains");
  }
  return envelope;
}

export async function preflightPlatformStoreMigration({ exportFile }) {
  const envelope = JSON.parse(await readFile(resolve(exportFile), "utf8"));
  verifyMigrationEnvelope(envelope);
  return {
    verified: true,
    exportId: envelope.exportId,
    platformDomain: envelope.platformDomain,
    counts: {
      hosts: envelope.hosts.length,
      hostOwners: envelope.hostOwners?.length ?? 0,
      tenants: envelope.tenants.length,
      tenantOwners: envelope.tenantOwners?.length ?? 0,
      tenantStaff: envelope.tenantStaff?.length ?? 0,
      customerAccounts: envelope.customerAccounts?.length ?? 0,
      customerOrders: envelope.customerOrders?.length ?? 0,
      auditEvents: envelope.auditEvents?.length ?? 0,
      domainClaims: envelope.tenantDomainClaims?.length ?? 0,
    },
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/platform-store-migration.mjs export [source-file] [destination-file] [--dry-run]",
    "  node scripts/platform-store-migration.mjs preflight <export-file>",
  ].join("\n");
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => arg !== "--dry-run");
  const [command, sourceArgument, destinationArgument] = positional;
  try {
    if (command === "export") {
      const result = await exportPlatformStoreMigration({
        sourceFile:
          sourceArgument ??
          process.env.PLATFORM_STORE_FILE ??
          resolve(process.cwd(), ".local", "platform-store.json"),
        destinationFile: destinationArgument,
        dryRun,
      });
      console.log(JSON.stringify({ counts: result.counts, dryRun }, null, 2));
    } else if (command === "preflight") {
      if (!sourceArgument) throw new Error(usage());
      const result = await preflightPlatformStoreMigration({
        exportFile: sourceArgument,
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error(usage());
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
