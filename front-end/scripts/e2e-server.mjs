import { hash } from "@node-rs/argon2";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createSqliteProductRepository } from "../../tenant-back-end/src/sqlite-product-repository.mjs";

const frontendRoot = resolve(import.meta.dirname, "..");
const backendRoot = resolve(frontendRoot, "..", "tenant-back-end");
if (!process.env.E2E_FIXTURE_DIR) {
  throw new Error("E2E_FIXTURE_DIR must be provided by the Playwright runner");
}
const fixtureRoot = resolve(process.env.E2E_FIXTURE_DIR);
const backendPort = 4110;
const frontendPort = 3100;
const platformSecretKey = randomBytes(32).toString("hex");
const sessionSecret = randomBytes(48).toString("base64url");
const apiKeys = {
  "11111111-1111-4111-8111-111111111111": "e2e-first-tenant-api-key-32-bytes",
  "22222222-2222-4222-8222-222222222222": "e2e-second-tenant-api-key-32bytes",
};
const passwords = {
  owner: "E2ETenantOwner-2026!",
  staff: "E2EOrderStaff-2026!",
  readOnly: "E2EReadOnlyStaff-2026!",
  otherStaff: "E2EOtherTenantStaff-2026!",
  customer: "E2ECustomerAccount-2026!",
};
const ids = {
  host: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tenant: "11111111-1111-4111-8111-111111111111",
  otherTenant: "22222222-2222-4222-8222-222222222222",
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  staff: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
  readOnlyStaff: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
  otherStaff: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  customer: "aaaaaaaa-aaaa-4aaa-8aaa-000000000004",
  otherCustomer: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
  order: "ORD-33333333-3333-4333-8333-333333333333",
  otherOrder: "ORD-44444444-4444-4444-8444-444444444444",
};

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(platformSecretKey, "hex"),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  });
}

const createdAt = new Date().toISOString();
const secretRefs = {
  tenant: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  otherTenant: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
};
const passwordHashes = await Promise.all([
  hash(passwords.owner),
  hash(passwords.staff),
  hash(passwords.readOnly),
  hash(passwords.otherStaff),
  hash(passwords.customer),
]);
const [ownerHash, staffHash, readOnlyHash, otherStaffHash, customerHash] =
  passwordHashes;
const tenantSettings = (name) => ({
  branding: {
    name,
    description: "Isolated order-management E2E fixture.",
    primaryColor: "#4338CA",
    accentColor: "#0F766E",
  },
  locale: {
    defaultLocale: "en",
    locales: ["en"],
    currency: "USD",
    currencies: ["USD"],
  },
});

const state = {
  initialized: true,
  setupTokenHash: null,
  platformDomain: "localhost",
  reservedSubdomains: [],
  superAdmins: [],
  hosts: [
    {
      id: ids.host,
      slug: "e2e-host",
      name: "E2E Host",
      status: "active",
      plan: "e2e",
      limits: {
        maxTenants: 10,
        maxCustomDomains: 0,
        features: { storefront: true, catalog: true },
      },
      branding: { name: "E2E Host" },
      domains: ["host.localhost"],
      supportContact: "support@example.test",
      createdAt,
      updatedAt: createdAt,
    },
  ],
  hostOwnerInvites: [],
  hostOwners: [],
  tenantOwnerInvites: [],
  tenantOwners: [
    {
      id: ids.owner,
      tenantId: ids.tenant,
      hostId: ids.host,
      email: "owner@store.e2e.test",
      passwordHash: ownerHash,
      createdAt,
    },
  ],
  tenantStaff: [
    {
      id: ids.staff,
      tenantId: ids.tenant,
      hostId: ids.host,
      email: "orders@store.e2e.test",
      passwordHash: staffHash,
      permissions: ["orders:read", "orders:write"],
      active: true,
      createdAt,
    },
    {
      id: ids.readOnlyStaff,
      tenantId: ids.tenant,
      hostId: ids.host,
      email: "readonly@store.e2e.test",
      passwordHash: readOnlyHash,
      permissions: ["orders:read"],
      active: true,
      createdAt,
    },
    {
      id: ids.otherStaff,
      tenantId: ids.otherTenant,
      hostId: ids.host,
      email: "orders@other.e2e.test",
      passwordHash: otherStaffHash,
      permissions: ["orders:read"],
      active: true,
      createdAt,
    },
  ],
  customerAccounts: [
    {
      id: ids.customer,
      tenantId: ids.tenant,
      email: "customer@store.e2e.test",
      passwordHash: customerHash,
      createdAt,
    },
  ],
  customerOrders: [],
  tenants: [
    {
      id: ids.tenant,
      hostId: ids.host,
      slug: "e2e-store",
      name: "E2E Store",
      status: "active",
      plan: "e2e",
      domains: ["store.localhost"],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: ids.otherTenant,
      hostId: ids.host,
      slug: "other-store",
      name: "Other E2E Store",
      status: "active",
      plan: "e2e",
      domains: ["other.localhost"],
      createdAt,
      updatedAt: createdAt,
    },
  ],
  tenantStoreSettings: [
    {
      tenantId: ids.tenant,
      hostId: ids.host,
      settings: tenantSettings("E2E Store"),
      updatedAt: createdAt,
    },
    {
      tenantId: ids.otherTenant,
      hostId: ids.host,
      settings: tenantSettings("Other E2E Store"),
      updatedAt: createdAt,
    },
  ],
  tenantRestConnections: [
    {
      tenantId: ids.tenant,
      hostId: ids.host,
      config: {
        type: "rest",
        baseUrl: `http://127.0.0.1:${backendPort}`,
        apiVersion: "v1",
        authMode: "apiKey",
        apiKeyRef: secretRefs.tenant,
      },
      updatedAt: createdAt,
    },
    {
      tenantId: ids.otherTenant,
      hostId: ids.host,
      config: {
        type: "rest",
        baseUrl: `http://127.0.0.1:${backendPort}`,
        apiVersion: "v1",
        authMode: "apiKey",
        apiKeyRef: secretRefs.otherTenant,
      },
      updatedAt: createdAt,
    },
  ],
  auditEvents: [],
  secrets: [
    {
      ref: secretRefs.tenant,
      tenantId: ids.tenant,
      name: "tenant-rest-api-key",
      encryptedValue: encryptSecret(apiKeys[ids.tenant]),
      createdAt,
    },
    {
      ref: secretRefs.otherTenant,
      tenantId: ids.otherTenant,
      name: "tenant-rest-api-key",
      encryptedValue: encryptSecret(apiKeys[ids.otherTenant]),
      createdAt,
    },
  ],
  rateLimits: {},
};

const order = (tenantId, customerId, id) => ({
  id,
  tenantId,
  customerId,
  status: "Confirmed",
  createdAt,
  items: [
    {
      productId: "product-1",
      title: "Order E2E Product",
      slug: "order-e2e-product",
      quantity: 2,
      unitPrice: 1250,
      currency: "USD",
    },
  ],
  total: 2500,
  currency: "USD",
  itemCount: 2,
});
const seededOrders = [
  order(ids.tenant, ids.customer, ids.order),
  order(ids.otherTenant, ids.otherCustomer, ids.otherOrder),
];
state.customerOrders.push(
  ...seededOrders.map((record) => ({
    ...record,
    backendSyncStatus: "synced",
  })),
);

const platformStoreFile = resolve(fixtureRoot, "platform-store.json");
const databaseFile = resolve(fixtureRoot, "tenant.sqlite");
await mkdir(fixtureRoot, { recursive: true });
await writeFile(platformStoreFile, `${JSON.stringify(state, null, 2)}\n`);
const repository = await createSqliteProductRepository(databaseFile);
try {
  for (const tenantOrder of seededOrders) {
    repository.createOrder(tenantOrder);
  }
} finally {
  repository.close();
}

const env = {
  ...process.env,
  NODE_ENV: "development",
  PLATFORM_STORE: "file",
  PLATFORM_STORE_FILE: platformStoreFile,
  PLATFORM_SECRET_KEY: platformSecretKey,
  SESSION_SECRET: sessionSecret,
  NEXT_PUBLIC_PLATFORM_DOMAIN: "localhost",
  TENANT_REST_ALLOW_LOCAL_HTTP: "true",
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_TELEMETRY_DISABLED: "1",
};
const backend = spawn(
  process.execPath,
  [resolve(backendRoot, "src/server.mjs")],
  {
    cwd: backendRoot,
    env: {
      ...env,
      HOST: "127.0.0.1",
      PORT: String(backendPort),
      DATABASE_FILE: databaseFile,
      TENANT_API_KEYS: JSON.stringify(apiKeys),
    },
    stdio: "inherit",
  },
);
const nextCli = resolve(
  frontendRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const frontend = spawn(
  process.execPath,
  [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
  { cwd: frontendRoot, env, stdio: "inherit" },
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [frontend, backend]) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await Promise.all(
    [frontend, backend].map(
      (child) =>
        new Promise((resolveExit) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolveExit();
          } else {
            child.once("exit", resolveExit);
          }
        }),
    ),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}

function waitForExit(child, name) {
  return new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!stopping) reject(new Error(`${name} exited unexpectedly (${code})`));
    });
  });
}

async function waitForUrl(url, init) {
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null || frontend.exitCode !== null) {
      throw new Error("An E2E server exited before becoming ready");
    }
    try {
      const response = await fetch(url, init);
      if (response.ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await Promise.race([
    waitForUrl(`http://127.0.0.1:${backendPort}/v1/health`, {
      headers: { "x-api-key": apiKeys[ids.tenant] },
    }),
    waitForExit(backend, "Tenant backend"),
  ]);
  await Promise.race([
    waitForUrl(`http://127.0.0.1:${frontendPort}/en`, {
      headers: { host: `store.localhost:${frontendPort}` },
    }),
    waitForExit(frontend, "Next.js"),
  ]);
  await new Promise(() => {});
} finally {
  await stop();
}
