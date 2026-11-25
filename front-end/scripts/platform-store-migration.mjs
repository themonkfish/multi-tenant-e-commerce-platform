import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

function decodeEncryptionKey(secret) {
  if (!secret) {
    throw new Error(
      "A 32-byte PLATFORM_SECRET_KEY is required for secret re-encryption",
    );
  }
  const key = /^[\da-f]{64}$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error(
      "Platform secret keys must encode exactly 32 bytes as 64 hex or 44 base64 characters",
    );
  }
  return key;
}

export function reencryptEncryptedSecret({
  encryptedValue,
  sourceKey,
  targetKey,
}) {
  const parsed = JSON.parse(encryptedValue);
  if (
    parsed.version !== 1 ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.authTag !== "string"
  ) {
    throw new Error("Invalid encrypted secret envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(sourceKey),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(targetKey),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  });
}

function snakeCaseRow(source, map) {
  const row = {};
  for (const [sourceKey, targetKey] of Object.entries(map)) {
    if (source[sourceKey] !== undefined) row[targetKey] = source[sourceKey];
  }
  return row;
}

export function buildPlatformStoreImportPayload({
  state,
  sourceKey,
  targetKey,
}) {
  const source = validateMigrationState(state);
  const reencrypt = (value) =>
    reencryptEncryptedSecret({
      encryptedValue: value,
      sourceKey,
      targetKey,
    });

  return {
    initialized: Boolean(source.initialized),
    platform_domain: source.platformDomain ?? null,
    reserved_subdomains: source.reservedSubdomains ?? [],
    platform_settings:
      source.platformSettings ?? source.platform_settings ?? null,
    super_admins: (source.superAdmins ?? []).map((admin) => ({
      id: admin.id,
      email: admin.email,
      password_hash: admin.passwordHash,
      totp_secret_ciphertext: reencrypt(admin.totpSecretCiphertext),
      recovery_code_hashes: admin.recoveryCodeHashes ?? [],
      created_at: admin.createdAt,
    })),
    hosts: source.hosts.map((host) =>
      snakeCaseRow(
        { ...host, domains: host.domains ?? [] },
        {
          id: "id",
          slug: "slug",
          name: "name",
          status: "status",
          plan: "plan",
          limits: "limits",
          branding: "branding",
          supportContact: "support_contact",
          createdAt: "created_at",
          updatedAt: "updated_at",
          domains: "domains",
        },
      ),
    ),
    host_owners: (source.hostOwners ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        hostId: "host_id",
        email: "email",
        passwordHash: "password_hash",
        createdAt: "created_at",
      }),
    ),
    host_owner_invites: (source.hostOwnerInvites ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        hostId: "host_id",
        email: "email",
        tokenHash: "token_hash",
        expiresAt: "expires_at",
        createdAt: "created_at",
      }),
    ),
    tenants: source.tenants.map((row) =>
      snakeCaseRow(
        { ...row, domains: row.domains ?? [] },
        {
          id: "id",
          hostId: "host_id",
          slug: "slug",
          name: "name",
          status: "status",
          plan: "plan",
          createdAt: "created_at",
          updatedAt: "updated_at",
          domains: "domains",
        },
      ),
    ),
    tenant_owners: (source.tenantOwners ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        hostId: "host_id",
        email: "email",
        passwordHash: "password_hash",
        createdAt: "created_at",
      }),
    ),
    tenant_owner_invites: (source.tenantOwnerInvites ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        hostId: "host_id",
        email: "email",
        tokenHash: "token_hash",
        expiresAt: "expires_at",
        createdAt: "created_at",
      }),
    ),
    tenant_staff: (source.tenantStaff ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        hostId: "host_id",
        email: "email",
        passwordHash: "password_hash",
        permissions: "permissions",
        active: "active",
        createdAt: "created_at",
      }),
    ),
    customer_accounts: (source.customerAccounts ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        email: "email",
        passwordHash: "password_hash",
        createdAt: "created_at",
      }),
    ),
    customer_password_resets: (source.customerPasswordResets ?? []).map(
      (row) =>
        snakeCaseRow(row, {
          id: "id",
          tenantId: "tenant_id",
          customerId: "customer_id",
          tokenHash: "token_hash",
          expiresAt: "expires_at",
          createdAt: "created_at",
        }),
    ),
    customer_orders: (source.customerOrders ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        customerId: "customer_id",
        status: "status",
        createdAt: "created_at",
        items: "items",
        subtotal: "subtotal",
        shippingAmount: "shipping_amount",
        discountCode: "discount_code",
        discountAmount: "discount_amount",
        taxRateBasisPoints: "tax_rate_basis_points",
        taxAmount: "tax_amount",
        total: "total",
        currency: "currency",
        itemCount: "item_count",
        paymentMethod: "payment_method",
        paymentStatus: "payment_status",
        paymentAttempt: "payment_attempt",
        paymentSessionId: "payment_session_id",
        paymentIntentId: "payment_intent_id",
        deliveryAddress: "delivery_address",
        fulfillment: "fulfillment",
        backendSyncStatus: "backend_sync_status",
        backendSyncError: "backend_sync_error",
      }),
    ),
    discount_redemptions: (source.discountRedemptions ?? []).map((row) =>
      snakeCaseRow(row, {
        tenantId: "tenant_id",
        orderId: "order_id",
        code: "code",
        status: "status",
        updatedAt: "updated_at",
      }),
    ),
    tenant_settings: (source.tenantStoreSettings ?? []).map((row) =>
      snakeCaseRow(row, {
        tenantId: "tenant_id",
        hostId: "host_id",
        settings: "settings",
        updatedAt: "updated_at",
        branding: "branding",
        locale: "locale",
      }),
    ),
    tenant_rest_connections: (source.tenantRestConnections ?? []).map((row) =>
      snakeCaseRow(row, {
        tenantId: "tenant_id",
        hostId: "host_id",
        config: "config",
        updatedAt: "updated_at",
      }),
    ),
    tenant_database_providers: (source.tenantDatabaseProviders ?? []).map(
      (row) =>
        snakeCaseRow(row, {
          tenantId: "tenant_id",
          hostId: "host_id",
          config: "config",
          updatedAt: "updated_at",
        }),
    ),
    tenant_storage_providers: (source.tenantStorageProviders ?? []).map(
      (row) =>
        snakeCaseRow(row, {
          tenantId: "tenant_id",
          hostId: "host_id",
          config: "config",
          updatedAt: "updated_at",
        }),
    ),
    tenant_domain_claims: (source.tenantDomainClaims ?? []).map((row) =>
      snakeCaseRow(row, {
        tenantId: "tenant_id",
        hostId: "host_id",
        domain: "domain",
        verificationToken: "verification_token",
        createdAt: "created_at",
      }),
    ),
    audit_events: (source.auditEvents ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        actorId: "actor_id",
        scope: "scope",
        action: "action",
        resourceType: "resource_type",
        resourceId: "resource_id",
        createdAt: "created_at",
      }),
    ),
    product_reviews: (source.productReviews ?? []).map((row) =>
      snakeCaseRow(row, {
        id: "id",
        tenantId: "tenant_id",
        productId: "product_id",
        customerId: "customer_id",
        rating: "rating",
        title: "title",
        body: "body",
        createdAt: "created_at",
      }),
    ),
    secrets: (source.secrets ?? []).map((record) => ({
      ref: record.ref,
      tenant_id: record.tenantId,
      name: record.name,
      encrypted_value: reencrypt(record.encryptedValue),
      created_at: record.createdAt,
    })),
  };
}

export async function importPlatformStore({
  sourceFile,
  sourceKey,
  targetKey,
  cutover = false,
  env = process.env,
  supabaseClient,
}) {
  const source = JSON.parse(await readFile(resolve(sourceFile), "utf8"));
  validateMigrationState(source);
  const payload = buildPlatformStoreImportPayload({
    state: source,
    sourceKey: sourceKey ?? env.SOURCE_PLATFORM_SECRET_KEY,
    targetKey: targetKey ?? env.PLATFORM_SECRET_KEY,
  });

  const client =
    supabaseClient ??
    createClient(
      env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL ??
        env.PLATFORM_SUPABASE_URL ??
        "",
      env.PLATFORM_SUPABASE_SERVICE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  if (
    !env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL &&
    !env.PLATFORM_SUPABASE_URL &&
    !supabaseClient
  ) {
    throw new Error(
      "NEXT_PUBLIC_PLATFORM_SUPABASE_URL and PLATFORM_SUPABASE_SERVICE_KEY are required",
    );
  }
  if (!env.PLATFORM_SUPABASE_SERVICE_KEY && !supabaseClient) {
    throw new Error("PLATFORM_SUPABASE_SERVICE_KEY is required");
  }

  const { data, error } = await client.rpc("import_platform_store", {
    p_payload: payload,
    p_cutover: cutover,
  });
  if (error) {
    throw new Error(`Platform-store import failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Platform-store target was not available for import");
  }
  return { imported: true, cutover, counts: data };
}

export async function rollbackPlatformStore({
  env = process.env,
  supabaseClient,
}) {
  const client =
    supabaseClient ??
    createClient(
      env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL ??
        env.PLATFORM_SUPABASE_URL ??
        "",
      env.PLATFORM_SUPABASE_SERVICE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  if (
    (!env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL &&
      !env.PLATFORM_SUPABASE_URL &&
      !supabaseClient) ||
    (!env.PLATFORM_SUPABASE_SERVICE_KEY && !supabaseClient)
  ) {
    throw new Error(
      "Platform Supabase URL and PLATFORM_SUPABASE_SERVICE_KEY are required",
    );
  }
  const { data, error } = await client.rpc("rollback_platform_store");
  if (error) {
    throw new Error(`Platform-store rollback failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Platform-store rollback was not applied");
  }
  return { rolledBack: true };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/platform-store-migration.mjs export [source-file] [destination-file] [--dry-run]",
    "  node scripts/platform-store-migration.mjs preflight <export-file>",
    "  node scripts/platform-store-migration.mjs import <source-state-file> [--cutover]",
    "  node scripts/platform-store-migration.mjs rollback",
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
    } else if (command === "import") {
      if (!sourceArgument) throw new Error(usage());
      if (positional.includes("--cutover") && process.env.MIGRATION_CUTOVER_CONFIRM !== "CUTOVER") {
        throw new Error(
          "Set MIGRATION_CUTOVER_CONFIRM=CUTOVER to activate the imported store",
        );
      }
      const result = await importPlatformStore({
        sourceFile: sourceArgument,
        cutover: positional.includes("--cutover"),
      });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "rollback") {
      if (process.env.MIGRATION_ROLLBACK_CONFIRM !== "ROLLBACK") {
        throw new Error(
          "Set MIGRATION_ROLLBACK_CONFIRM=ROLLBACK to clear the migrated Supabase target",
        );
      }
      const result = await rollbackPlatformStore();
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error(usage());
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
