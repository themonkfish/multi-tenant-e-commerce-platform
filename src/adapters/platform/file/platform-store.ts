import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
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
  superAdmins: z.array(SuperAdminSchema),
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
  superAdmins: [],
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
