import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createTenantApiServer } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createSqliteProductRepository } from "../src/sqlite-product-repository.mjs";

const tenantId = "tenant-test-a";
const otherTenantId = "tenant-test-b";
const apiKey = "tenant-test-secret-key-which-is-long";
const otherApiKey = "another-tenant-secret-key-long";
let server;
let repository;
let baseUrl;
let temporaryDirectory;

test("configuration defaults to SQLite and requires tenant credentials", () => {
  const config = loadConfig({
    DEFAULT_TENANT_ID: tenantId,
    TENANT_API_KEY: apiKey,
  });
  assert.equal(config.databaseProvider, "sqlite");
  assert.equal(config.port, 4100);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.tenantApiKeys.get(tenantId), apiKey);

  assert.throws(
    () => loadConfig({ DATABASE_PROVIDER: "postgres" }),
    /Unsupported DATABASE_PROVIDER/,
  );
  assert.throws(
    () => loadConfig({ DEFAULT_TENANT_ID: tenantId }),
    /TENANT_API_KEY/,
  );
});

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "tenant-api-test-"));
  repository = await createSqliteProductRepository(
    join(temporaryDirectory, "tenant.sqlite"),
  );
  server = createTenantApiServer({
    tenantApiKeys: new Map([
      [tenantId, apiKey],
      [otherTenantId, otherApiKey],
    ]),
    repository,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  repository?.close();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function auth(key = apiKey) {
  return { "X-API-Key": key };
}

test("health check returns the contract required by the frontend", async () => {
  const response = await fetch(`${baseUrl}/health`, { headers: auth() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "healthy",
    db: "up",
    storage: "up",
    schemaVersion: "2",
  });

  const unauthorized = await fetch(`${baseUrl}/health`);
  assert.equal(unauthorized.status, 401);
});

test("requires a valid API key and binds operations to its tenant", async () => {
  const missingKey = await fetch(`${baseUrl}/products`);
  assert.equal(missingKey.status, 401);

  const wrongScope = await fetch(
    `${baseUrl}/products?tenantId=${otherTenantId}&page=1&limit=20`,
    { headers: auth() },
  );
  assert.equal(wrongScope.status, 403);

  const emptyOtherTenant = await fetch(
    `${baseUrl}/products?tenantId=${otherTenantId}&page=1&limit=20`,
    { headers: auth(otherApiKey) },
  );
  assert.equal(emptyOtherTenant.status, 200);
  assert.deepEqual((await emptyOtherTenant.json()).data, []);
});

test("creates, lists, reads, updates, and deletes products", async () => {
  const createResponse = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      tenantId,
      title: "Canvas Bag",
      slug: "canvas-bag",
      status: "active",
      price: { amount: 1999, currency: "USD" },
      sku: "BAG-1",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.tenantId, tenantId);
  assert.equal(created.title, "Canvas Bag");
  assert.equal(created.price.amount, 1999);
  assert.ok(created.createdAt);

  const crossTenantRead = await fetch(`${baseUrl}/products/${created.id}`, {
    headers: auth(otherApiKey),
  });
  assert.equal(crossTenantRead.status, 404);

  const listResponse = await fetch(
    `${baseUrl}/products?tenantId=${tenantId}&page=1&limit=20`,
    { headers: auth() },
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).meta, {
    page: 1,
    limit: 20,
    total: 1,
  });

  const readResponse = await fetch(`${baseUrl}/products/${created.id}`, {
    headers: auth(),
  });
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).id, created.id);

  const updateResponse = await fetch(`${baseUrl}/products/${created.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ title: "Updated Canvas Bag" }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).title, "Updated Canvas Bag");

  const deleteResponse = await fetch(`${baseUrl}/products/${created.id}`, {
    method: "DELETE",
    headers: auth(),
  });
  assert.equal(deleteResponse.status, 204);

  const missingResponse = await fetch(`${baseUrl}/products/${created.id}`, {
    headers: auth(),
  });
  assert.equal(missingResponse.status, 404);
});

test("rejects invalid payloads, duplicate slugs, and invalid pagination", async () => {
  const invalidResponse = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      tenantId,
      title: "Bad",
      slug: "../bad",
      status: "active",
      price: { amount: -1, currency: "usd" },
    }),
  });
  assert.equal(invalidResponse.status, 400);

  const input = {
    tenantId,
    title: "First Product",
    slug: "first-product",
    status: "draft",
    price: { amount: 0, currency: "USD" },
  };
  const first = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(first.status, 201);
  const duplicate = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(duplicate.status, 409);

  const badPage = await fetch(
    `${baseUrl}/products?tenantId=${tenantId}&page=0&limit=101`,
    { headers: auth() },
  );
  assert.equal(badPage.status, 400);
});

test("persists tenant orders idempotently and rejects mismatched replays", async () => {
  const order = {
    id: "ORD-550e8400-e29b-41d4-a716-446655440000",
    tenantId,
    customerId: "550e8400-e29b-41d4-a716-446655440001",
    status: "Confirmed",
    createdAt: "2026-10-22T12:00:00.000Z",
    items: [
      {
        productId: "product-1",
        title: "Canvas Bag",
        slug: "canvas-bag",
        quantity: 2,
        unitPrice: 1250,
        currency: "USD",
      },
    ],
    total: 2500,
    currency: "USD",
    itemCount: 2,
  };
  const create = (body, key = apiKey) =>
    fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { ...auth(key), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const created = await create(order);
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).order, order);

  const replay = await create(order);
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).order, order);

  const conflict = await create({
    ...order,
    items: [{ ...order.items[0], title: "Renamed bag" }],
  });
  assert.equal(conflict.status, 409);

  const wrongTenant = await create({ ...order, tenantId: otherTenantId });
  assert.equal(wrongTenant.status, 403);

  const read = await fetch(`${baseUrl}/orders/${order.id}`, {
    headers: auth(),
  });
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).order, order);

  const isolatedRead = await fetch(`${baseUrl}/orders/${order.id}`, {
    headers: auth(otherApiKey),
  });
  assert.equal(isolatedRead.status, 404);
});

test("seeds products without overwriting an existing tenant catalog", () => {
  const seedTenantId = "tenant-seed-test";
  const now = new Date().toISOString();
  const sample = {
    id: "product-seed-test",
    title: "Seed Product",
    slug: "seed-product",
    status: "active",
    price: { amount: 1250, currency: "USD" },
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(repository.seedProducts(seedTenantId, [sample]), 1);
  assert.throws(
    () => repository.seedProducts(seedTenantId, [sample]),
    /already has products/,
  );
  assert.equal(
    repository.listProducts({ tenantId: seedTenantId, page: 1, limit: 20 }).meta
      .total,
    1,
  );
});
