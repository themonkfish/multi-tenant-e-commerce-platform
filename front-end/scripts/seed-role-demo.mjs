import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const frontendRoot = resolve(import.meta.dirname, "..");
const storeFile = resolve(frontendRoot, ".local", "demo-platform-store.json");
const credentialsFile = resolve(
  frontendRoot,
  ".local",
  "demo-role-credentials.txt",
);
const lockFile = `${storeFile}.lock`;
const temporaryStoreFile = `${storeFile}.${randomUUID()}.tmp`;
const staffEmail = "staff@store.demo.local";
const customerEmail = "customer@store.demo.local";
const secondCustomerEmail = "customer2@store.demo.local";
const staffPassword = "DemoCatalogStaff-2026!";
const customerPassword = "DemoCustomer-2026!";
const secondCustomerPassword = "DemoCustomerTwo-2026!";
const legacyCredentials = [
  "DEMO ROLE FIXTURES - local development only",
  "",
  `Tenant Staff: ${staffEmail} / ${staffPassword}`,
  "Staff login: /en/tenant/staff/login (catalog read and write).",
  "",
  `Customer: ${customerEmail} / ${customerPassword}`,
  "Customer login: /en/customer/login (two private sample orders).",
  "",
  "Keep this file private. These accounts use the isolated demo platform store.",
  "",
].join("\n");
const currentCredentials = [
  "DEMO ROLE FIXTURES - local development only",
  "",
  `Tenant Staff: ${staffEmail} / ${staffPassword}`,
  "Staff login: /en/tenant/staff/login (catalog read and write).",
  "",
  `Customer: ${customerEmail} / ${customerPassword}`,
  "Customer login: /en/customer/login (two private sample orders).",
  "",
  `Second Customer: ${secondCustomerEmail} / ${secondCustomerPassword}`,
  "This account has one sample order and cannot see the first customer's orders.",
  "",
  "Keep this file private. These accounts use the isolated demo platform store.",
  "",
].join("\n");
let lockHandle;

try {
  lockHandle = await open(lockFile, "wx", 0o600);
  let previousCredentials = null;
  try {
    previousCredentials = await readFile(credentialsFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const isLegacyFixture = previousCredentials === legacyCredentials;
  const isCurrentFixture = previousCredentials === currentCredentials;
  if (previousCredentials && !isLegacyFixture && !isCurrentFixture) {
    throw new Error(
      "Role demo credentials exist but do not match the known fixture. The data was not changed.",
    );
  }

  const state = JSON.parse(await readFile(storeFile, "utf8"));
  if (!state.initialized) {
    throw new Error("The isolated demo platform store is not initialized.");
  }
  const tenant = state.tenants?.find(
    (record) => record.slug === "demo-store" && record.status === "active",
  );
  const host = tenant
    ? state.hosts?.find(
        (record) => record.id === tenant.hostId && record.status === "active",
      )
    : null;
  if (!tenant || !host) {
    throw new Error(
      "The active demo tenant and host were not found; role fixtures were not added.",
    );
  }
  state.tenantStaff ??= [];
  state.customerAccounts ??= [];
  state.customerOrders ??= [];
  state.auditEvents ??= [];
  const staff = state.tenantStaff.find(
    (record) => record.tenantId === tenant.id && record.email === staffEmail,
  );
  const customer = state.customerAccounts.find(
    (record) => record.tenantId === tenant.id && record.email === customerEmail,
  );
  const secondCustomer = state.customerAccounts.find(
    (record) =>
      record.tenantId === tenant.id && record.email === secondCustomerEmail,
  );
  const seededSecondCustomer = secondCustomer
    ? state.auditEvents.some(
        (event) =>
          event.action === "customer.demo_seeded" &&
          event.resourceId === secondCustomer.id,
      )
    : false;
  if (
    previousCredentials &&
    (!staff ||
      !customer ||
      (isCurrentFixture && (!secondCustomer || !seededSecondCustomer)) ||
      (secondCustomer && !seededSecondCustomer))
  ) {
    throw new Error(
      "The existing role fixture is incomplete or conflicts with demo data. It was not changed.",
    );
  }
  if (
    !previousCredentials &&
    (staff || customer || (secondCustomer && !seededSecondCustomer))
  ) {
    throw new Error(
      "Role demo accounts already exist. The fixture was not changed.",
    );
  }

  const [staffPasswordHash, customerPasswordHash, secondCustomerPasswordHash] =
    await Promise.all([
      hash(staffPassword),
      hash(customerPassword),
      hash(secondCustomerPassword),
    ]);
  const customerId = customer?.id ?? randomUUID();
  const secondCustomerId = secondCustomer?.id ?? randomUUID();
  const createdAt = new Date().toISOString();
  const auditEvent = (action, resourceType, resourceId) => ({
    id: randomUUID(),
    actorId: "demo-seed",
    scope: { kind: "tenant", id: tenant.id, hostId: host.id },
    action,
    resourceType,
    resourceId,
    createdAt,
  });

  if (!staff) {
    state.tenantStaff.push({
      id: randomUUID(),
      tenantId: tenant.id,
      hostId: host.id,
      email: staffEmail,
      passwordHash: staffPasswordHash,
      permissions: ["catalog:read", "catalog:write"],
      active: true,
      createdAt,
    });
    state.auditEvents.push(
      auditEvent("tenant.staff.demo_seeded", "tenant_staff", staffEmail),
    );
  }
  if (!customer) {
    state.customerAccounts.push({
      id: customerId,
      tenantId: tenant.id,
      email: customerEmail,
      passwordHash: customerPasswordHash,
      createdAt,
    });
    state.auditEvents.push(
      auditEvent("customer.demo_seeded", "customer_account", customerId),
    );
  }
  if (!secondCustomer) {
    state.customerAccounts.push({
      id: secondCustomerId,
      tenantId: tenant.id,
      email: secondCustomerEmail,
      passwordHash: secondCustomerPasswordHash,
      createdAt,
    });
    state.auditEvents.push(
      auditEvent("customer.demo_seeded", "customer_account", secondCustomerId),
    );
  }

  const fixtureOrders = [
    {
      id: "DEMO-ORDER-1001",
      tenantId: tenant.id,
      customerId,
      status: "Processing",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      total: 5600,
      currency: "USD",
      itemCount: 2,
    },
    {
      id: "DEMO-ORDER-1002",
      tenantId: tenant.id,
      customerId,
      status: "Shipped",
      createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      total: 3200,
      currency: "USD",
      itemCount: 1,
    },
    {
      id: "DEMO-ORDER-1003",
      tenantId: tenant.id,
      customerId: secondCustomerId,
      status: "Confirmed",
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      total: 4100,
      currency: "USD",
      itemCount: 2,
    },
  ];
  for (const order of fixtureOrders) {
    const existingOrder = state.customerOrders.find(
      (record) => record.tenantId === tenant.id && record.id === order.id,
    );
    if (
      existingOrder &&
      (existingOrder.customerId !== order.customerId ||
        existingOrder.total !== order.total)
    ) {
      throw new Error(
        `Demo order ${order.id} already exists with different ownership or data.`,
      );
    }
    if (!existingOrder) state.customerOrders.push(order);
  }

  const credentials = currentCredentials;
  await mkdir(dirname(storeFile), { recursive: true, mode: 0o700 });
  await writeFile(temporaryStoreFile, `${JSON.stringify(state, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryStoreFile, storeFile);
  await writeFile(credentialsFile, credentials, {
    ...(previousCredentials ? { flag: "w" } : { flag: "wx" }),
    mode: 0o600,
  });
  console.info(`Added role fixtures to ${storeFile}`);
  console.info(`Credentials: ${credentialsFile}`);
} catch (error) {
  await unlink(temporaryStoreFile).catch((cleanupError) => {
    if (cleanupError.code !== "ENOENT") throw cleanupError;
  });
  throw error;
} finally {
  if (lockHandle) {
    await lockHandle.close();
    await unlink(lockFile);
  }
}
