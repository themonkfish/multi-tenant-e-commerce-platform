import { hash } from "@node-rs/argon2";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as OTPAuth from "otpauth";
import { createSqliteProductRepository } from "../../tenant-back-end/src/sqlite-product-repository.mjs";

const frontendRoot = resolve(import.meta.dirname, "..");
const backendRoot = resolve(frontendRoot, "..", "tenant-back-end");
const storeFile = resolve(frontendRoot, ".local", "demo-platform-store.json");
const databaseFile = resolve(backendRoot, "data", "demo-tenant.sqlite");
const frontendEnvFile = resolve(frontendRoot, ".env.demo");
const backendEnvFile = resolve(backendRoot, ".env.demo");
const credentialsFile = resolve(frontendRoot, ".local", "demo-credentials.txt");
const targets = [
  storeFile,
  databaseFile,
  frontendEnvFile,
  backendEnvFile,
  credentialsFile,
];

for (const target of targets) {
  try {
    await access(target);
    throw new Error(
      `Demo data already exists at ${target}. It was not changed; remove that exact demo file manually before reseeding.`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const createdAt = new Date().toISOString();
const hostId = randomUUID();
const tenantId = randomUUID();
const adminId = randomUUID();
const hostOwnerId = randomUUID();
const tenantOwnerId = randomUUID();
const staffId = randomUUID();
const customerId = randomUUID();
const secondCustomerId = randomUUID();
const secretRef = randomUUID();
const apiKey = randomBytes(32).toString("base64url");
const platformSecretKey = randomBytes(32).toString("hex");
const sessionSecret = randomBytes(48).toString("base64url");
const adminPassword = "DemoSuperAdmin-2026!";
const hostOwnerPassword = "DemoHostOwner-2026!";
const tenantOwnerPassword = "DemoTenantOwner-2026!";
const staffPassword = "DemoCatalogStaff-2026!";
const customerPassword = "DemoCustomer-2026!";
const secondCustomerPassword = "DemoCustomerTwo-2026!";
const totpSecret = new OTPAuth.Secret();

function encryptDemoSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(platformSecretKey, "hex"),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

const [
  adminPasswordHash,
  hostOwnerPasswordHash,
  tenantOwnerPasswordHash,
  staffPasswordHash,
  customerPasswordHash,
  secondCustomerPasswordHash,
] = await Promise.all([
  hash(adminPassword),
  hash(hostOwnerPassword),
  hash(tenantOwnerPassword),
  hash(staffPassword),
  hash(customerPassword),
  hash(secondCustomerPassword),
]);

const productNames = [
  ["Everyday Canvas Tote", "everyday-canvas-tote", "TOTE-001", 2400, "active"],
  [
    "Insulated Travel Bottle",
    "insulated-travel-bottle",
    "BOTTLE-001",
    3200,
    "active",
  ],
  ["Organic Cotton Tee", "organic-cotton-tee", "TEE-001", 2800, "active"],
  [
    "Weekend Market Basket",
    "weekend-market-basket",
    "BASKET-001",
    4100,
    "active",
  ],
  ["Demo Draft Product", "demo-draft-product", "DEMO-001", 1500, "draft"],
];
const products = productNames.map(
  ([title, slug, sku, amount, status], index) => ({
    id: randomUUID(),
    title,
    slug,
    status,
    price: { amount, currency: "USD" },
    sku,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    updatedAt: createdAt,
  }),
);

const state = {
  initialized: true,
  setupTokenHash: null,
  platformDomain: "localhost",
  reservedSubdomains: [],
  superAdmins: [
    {
      id: adminId,
      email: "admin@demo.local",
      passwordHash: adminPasswordHash,
      totpSecretCiphertext: JSON.stringify(
        encryptDemoSecret(totpSecret.base32),
      ),
      recoveryCodeHashes: [],
      createdAt,
    },
  ],
  hosts: [
    {
      id: hostId,
      slug: "demo-host",
      name: "Demo Host",
      status: "active",
      plan: "demo",
      limits: {
        maxTenants: 10,
        maxCustomDomains: 5,
        features: { storefront: true, catalog: true },
      },
      branding: { name: "Demo Host" },
      domains: ["host.localhost"],
      supportContact: "support@demo.local",
      createdAt,
      updatedAt: createdAt,
    },
  ],
  hostOwnerInvites: [],
  hostOwners: [
    {
      id: hostOwnerId,
      hostId,
      email: "owner@host.demo.local",
      passwordHash: hostOwnerPasswordHash,
      createdAt,
    },
  ],
  tenantOwnerInvites: [],
  tenantOwners: [
    {
      id: tenantOwnerId,
      tenantId,
      hostId,
      email: "owner@store.demo.local",
      passwordHash: tenantOwnerPasswordHash,
      createdAt,
    },
  ],
  tenantStaff: [
    {
      id: staffId,
      tenantId,
      hostId,
      email: "staff@store.demo.local",
      passwordHash: staffPasswordHash,
      permissions: ["catalog:read", "catalog:write"],
      active: true,
      createdAt,
    },
  ],
  customerAccounts: [
    {
      id: customerId,
      tenantId,
      email: "customer@store.demo.local",
      passwordHash: customerPasswordHash,
      createdAt,
    },
    {
      id: secondCustomerId,
      tenantId,
      email: "customer2@store.demo.local",
      passwordHash: secondCustomerPasswordHash,
      createdAt,
    },
  ],
  customerOrders: [
    {
      id: "DEMO-ORDER-1001",
      tenantId,
      customerId,
      status: "Processing",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      total: 5600,
      currency: "USD",
      itemCount: 2,
    },
    {
      id: "DEMO-ORDER-1002",
      tenantId,
      customerId,
      status: "Shipped",
      createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      total: 3200,
      currency: "USD",
      itemCount: 1,
    },
    {
      id: "DEMO-ORDER-1003",
      tenantId,
      customerId: secondCustomerId,
      status: "Confirmed",
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      total: 4100,
      currency: "USD",
      itemCount: 2,
    },
  ],
  tenants: [
    {
      id: tenantId,
      hostId,
      slug: "demo-store",
      name: "Demo Store",
      status: "active",
      plan: "starter",
      domains: ["store.localhost"],
      createdAt,
      updatedAt: createdAt,
    },
  ],
  tenantStoreSettings: [
    {
      tenantId,
      hostId,
      settings: {
        branding: {
          name: "Demo Store",
          description:
            "A sample shop with products for testing the storefront.",
          primaryColor: "#4338CA",
          accentColor: "#0F766E",
        },
        locale: {
          defaultLocale: "en",
          locales: ["en"],
          currency: "USD",
          currencies: ["USD"],
        },
        shipping: { flatRate: 0 },
        tax: { rateBasisPoints: 825 },
        discounts: [{ code: "DEMO10", type: "percentage", value: 10 }],
      },
      updatedAt: createdAt,
    },
  ],
  tenantRestConnections: [
    {
      tenantId,
      hostId,
      config: {
        type: "rest",
        baseUrl: "http://127.0.0.1:4100",
        apiVersion: "v1",
        authMode: "apiKey",
        apiKeyRef: secretRef,
      },
      updatedAt: createdAt,
    },
  ],
  auditEvents: [],
  secrets: [
    {
      ref: secretRef,
      tenantId,
      name: "tenant-rest-api-key",
      encryptedValue: JSON.stringify(encryptDemoSecret(apiKey)),
      createdAt,
    },
  ],
  rateLimits: {},
};

await mkdir(dirname(storeFile), { recursive: true });
const repository = await createSqliteProductRepository(databaseFile);
try {
  repository.seedProducts(
    tenantId,
    products.map((product) => ({ ...product, tenantId })),
  );
} finally {
  repository.close();
}

const backendEnv = [
  "HOST=127.0.0.1",
  "PORT=4100",
  "DATABASE_FILE=./data/demo-tenant.sqlite",
  `TENANT_API_KEYS=${JSON.stringify({ [tenantId]: apiKey })}`,
  "",
].join("\n");
const frontendEnv = [
  "NODE_ENV=development",
  "PLATFORM_STORE=file",
  "PLATFORM_STORE_FILE=.local/demo-platform-store.json",
  `PLATFORM_SECRET_KEY=${platformSecretKey}`,
  `SESSION_SECRET=${sessionSecret}`,
  "NEXT_PUBLIC_PLATFORM_DOMAIN=localhost",
  "TENANT_REST_ALLOW_LOCAL_HTTP=true",
  "DEMO_CHECKOUT_ENABLED=true",
  "",
].join("\n");
const credentials = [
  "DEMO DATA - local development only",
  "",
  `Super Admin: admin@demo.local / ${adminPassword}`,
  `TOTP secret: ${totpSecret.base32}`,
  "Use this secret in any standard TOTP authenticator app.",
  "",
  `Host Owner: owner@host.demo.local / ${hostOwnerPassword}`,
  `Tenant Owner: owner@store.demo.local / ${tenantOwnerPassword}`,
  `Tenant Staff: staff@store.demo.local / ${staffPassword}`,
  `Customer: customer@store.demo.local / ${customerPassword}`,
  `Second Customer: customer2@store.demo.local / ${secondCustomerPassword}`,
  "Staff login: /en/tenant/staff/login (catalog access only).",
  "Customer login: /en/customer/login (own orders only).",
  "",
  `Tenant ID: ${tenantId}`,
  `Tenant API key: ${apiKey}`,
  "",
  "Keep this file private. The generated demo environment files contain the",
  "encryption/session keys required to use this demo data.",
  "",
].join("\n");

await writeFile(storeFile, `${JSON.stringify(state, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
await writeFile(frontendEnvFile, frontendEnv, { flag: "wx", mode: 0o600 });
await writeFile(backendEnvFile, backendEnv, { flag: "wx", mode: 0o600 });
await writeFile(credentialsFile, credentials, { flag: "wx", mode: 0o600 });

console.info(`Created ${products.length} tenant products for ${tenantId}.`);
console.info("Demo data is separate from existing platform and backend data.");
console.info(`Credentials: ${credentialsFile}`);
console.info("Start the API with: npm run tenant-backend:demo");
console.info("Start the website with: npm run dev:demo");
console.info("Open the storefront at http://store.localhost:3000/en");
