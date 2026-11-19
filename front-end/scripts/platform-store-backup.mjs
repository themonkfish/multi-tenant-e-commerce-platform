import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
  unlink,
  readdir,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_STATE_FIELDS = [
  "initialized",
  "setupTokenHash",
  "platformDomain",
  "reservedSubdomains",
  "platformSettings",
  "superAdmins",
  "hosts",
  "hostOwners",
  "tenants",
  "tenantStaff",
  "customerAccounts",
  "customerOrders",
  "auditEvents",
  "secrets",
  "rateLimits",
];

function usage() {
  return [
    "Usage:",
    "  node scripts/platform-store-backup.mjs backup [target-directory]",
    "  node scripts/platform-store-backup.mjs restore <backup-file> --force",
    "  node scripts/platform-store-backup.mjs rotate [target-directory] --keep=<count>",
  ].join("\n");
}

export function validateFileState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backup is not a platform state object");
  }
  for (const field of REQUIRED_STATE_FIELDS) {
    if (!(field in value)) {
      throw new Error(`Backup is missing required field: ${field}`);
    }
  }
  if (typeof value.initialized !== "boolean") {
    throw new Error("Backup field initialized must be a boolean");
  }
  if (
    !Array.isArray(value.auditEvents) ||
    !Array.isArray(value.secrets) ||
    !Array.isArray(value.hosts) ||
    !Array.isArray(value.tenants) ||
    typeof value.rateLimits !== "object" ||
    value.rateLimits === null ||
    Array.isArray(value.rateLimits)
  ) {
    throw new Error("Backup contains invalid collection fields");
  }
  return value;
}

export function createBackupEnvelope(state, now = new Date()) {
  validateFileState(state);
  const stateJson = JSON.stringify(state);
  return {
    format: "platform-store-backup",
    formatVersion: 1,
    createdAt: now.toISOString(),
    backupId: randomUUID(),
    sha256: createHash("sha256").update(stateJson).digest("hex"),
    state,
  };
}

export function verifyBackupEnvelope(envelope) {
  if (
    !envelope ||
    envelope.format !== "platform-store-backup" ||
    envelope.formatVersion !== 1
  ) {
    throw new Error("Unsupported platform-store backup format");
  }
  const state = validateFileState(envelope.state);
  const stateJson = JSON.stringify(state);
  const actual = createHash("sha256").update(stateJson).digest("hex");
  if (!envelope.sha256 || envelope.sha256 !== actual) {
    throw new Error("Backup checksum mismatch");
  }
  return state;
}

export async function backupPlatformStore({
  sourceFile,
  targetDirectory = "backups",
  now = new Date(),
}) {
  const source = resolve(sourceFile);
  const sourceStats = await stat(source);
  if (!sourceStats.isFile()) {
    throw new Error("Platform store file was not found");
  }
  const state = validateFileState(JSON.parse(await readFile(source, "utf8")));
  const envelope = createBackupEnvelope(state, now);
  const destinationDirectory = resolve(targetDirectory);
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const destination = resolve(
    destinationDirectory,
    `platform-store-${timestamp}.json`,
  );
  await writeFile(destination, `${JSON.stringify(envelope, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return destination;
}

export async function restorePlatformStore({
  sourceBackup,
  targetFile,
  force = false,
}) {
  if (!force) {
    throw new Error("Restore requires --force");
  }
  const backup = resolve(sourceBackup);
  const target = resolve(targetFile);
  if (backup === target) {
    throw new Error("Backup and target platform-store files must differ");
  }
  const state = verifyBackupEnvelope(
    JSON.parse(await readFile(backup, "utf8")),
  );
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  let preRestorePath = null;
  try {
    await stat(target);
    preRestorePath = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(target, preRestorePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (preRestorePath) {
      await rename(preRestorePath, target).catch(() => undefined);
    }
    throw error;
  }
  return target;
}

export async function rotatePlatformStoreBackups({
  targetDirectory = "backups",
  keep = 10,
}) {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 365) {
    throw new Error("Backup rotation keep count must be between 1 and 365");
  }
  const directory = resolve(targetDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const backups = (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            /^platform-store-\d{4}-\d{2}-\d{2}T.*\.json$/.test(entry.name),
        )
        .map(async (entry) => {
          const path = resolve(directory, entry.name);
          const details = await stat(path);
          return { name: entry.name, path, mtimeMs: details.mtimeMs };
        }),
    )
  ).sort(
    (left, right) =>
      right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name),
  );
  const removed = backups.slice(keep).map((backup) => backup.path);
  await Promise.all(removed.map((path) => unlink(path)));
  return removed;
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const [command, argument, ...options] = process.argv.slice(2);
  const sourceFile =
    process.env.PLATFORM_STORE_FILE ??
    resolve(process.cwd(), ".local", "platform-store.json");
  try {
    if (command === "backup") {
      const destination = await backupPlatformStore({
        sourceFile,
        targetDirectory: argument ?? "backups",
      });
      console.log(destination);
    } else if (command === "restore") {
      if (!argument) throw new Error("Restore backup file is required");
      const destination = await restorePlatformStore({
        sourceBackup: argument,
        targetFile: sourceFile,
        force: options.includes("--force"),
      });
      console.log(destination);
    } else if (command === "rotate") {
      const keepOption = options.find((option) => option.startsWith("--keep="));
      const keep = keepOption ? Number(keepOption.slice("--keep=".length)) : 10;
      const removed = await rotatePlatformStoreBackups({
        targetDirectory: argument ?? "backups",
        keep,
      });
      console.log(`Removed ${removed.length} old platform-store backup(s)`);
    } else {
      throw new Error(usage());
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
