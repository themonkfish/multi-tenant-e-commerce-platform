import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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
    schemaVersion: "9",
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

test("persists category, image, options, stock variants, and variant pricing", async () => {
  const createResponse = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      tenantId,
      title: "Variant Bag",
      slug: "variant-bag",
      status: "active",
      price: { amount: 1999, currency: "USD" },
      sku: "BAG-DEFAULT",
      category: "Bags",
      imageUrl: "https://cdn.example.test/variant-bag.webp",
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { selections: { Size: "S" }, stock: 4 },
        { selections: { Size: "M" }, stock: 8 },
      ],
      variantPricing: [
        { selections: { Size: "M" }, amount: 2299, sku: "BAG-M" },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.category, "Bags");
  assert.equal(created.imageUrl, "https://cdn.example.test/variant-bag.webp");
  assert.deepEqual(created.options, [{ name: "Size", values: ["S", "M"] }]);
  assert.equal(created.variants.length, 2);
  assert.deepEqual(created.variantPricing, [
    { selections: { Size: "M" }, amount: 2299, sku: "BAG-M" },
  ]);

  const updateResponse = await fetch(`${baseUrl}/products/${created.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      title: "Updated Variant Bag",
      category: "Travel",
      variantPricing: [
        { selections: { Size: "S" }, amount: 2099, sku: "BAG-S" },
      ],
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.title, "Updated Variant Bag");
  assert.equal(updated.category, "Travel");
  assert.deepEqual(updated.variantPricing, [
    { selections: { Size: "S" }, amount: 2099, sku: "BAG-S" },
  ]);
});

test("reserves, commits, and restores tenant inventory idempotently", async () => {
  const productResponse = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      tenantId,
      title: "Stocked Bag",
      slug: "stocked-bag",
      status: "active",
      price: { amount: 1999, currency: "USD" },
      options: [{ name: "Size", values: ["M"] }],
      variants: [{ selections: { Size: "M" }, stock: 5 }],
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = await productResponse.json();
  const reservation = {
    tenantId,
    reservationId: "order-stock-reservation",
    items: [{ productId: product.id, selections: { Size: "M" }, quantity: 2 }],
  };
  const reserve = () =>
    fetch(`${baseUrl}/products/inventory/reservations`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify(reservation),
    });

  const reserved = await reserve();
  assert.equal(reserved.status, 200);
  assert.deepEqual(await reserved.json(), { reserved: true });
  const replay = await reserve();
  assert.deepEqual(await replay.json(), { reserved: true });

  const afterReserve = await fetch(`${baseUrl}/products/${product.id}`, {
    headers: auth(),
  });
  assert.equal((await afterReserve.json()).variants[0].stock, 3);

  const action = (name) =>
    fetch(
      `${baseUrl}/products/inventory/reservations/${reservation.reservationId}/${name}`,
      {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      },
    );
  const committed = await action("commit");
  assert.deepEqual(await committed.json(), { status: "committed" });
  const restored = await action("restore");
  assert.deepEqual(await restored.json(), { status: "restored" });
  const restoreReplay = await action("restore");
  assert.deepEqual(await restoreReplay.json(), { status: "restored" });

  const afterRestore = await fetch(`${baseUrl}/products/${product.id}`, {
    headers: auth(),
  });
  assert.equal((await afterRestore.json()).variants[0].stock, 5);
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
        variantSelections: { Color: "Blue" },
        sku: "BAG-BLUE",
        inventoryTracked: true,
        unitPrice: 1250,
        currency: "USD",
      },
    ],
    subtotal: 2500,
    shippingAmount: 100,
    discountCode: "SAVE10",
    discountAmount: 200,
    taxRateBasisPoints: 800,
    taxAmount: 184,
    total: 2584,
    currency: "USD",
    itemCount: 2,
    paymentMethod: "stripe",
    deliveryAddress: {
      fullName: "Test Customer",
      line1: "1 Market Road",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
      country: "IN",
      phone: "+919876543210",
    },
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

  const invalidAmounts = await create({
    ...order,
    id: "ORD-550e8400-e29b-41d4-a716-446655440002",
    taxAmount: 185,
  });
  assert.equal(invalidAmounts.status, 400);

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

  const listed = await fetch(`${baseUrl}/orders?page=1&limit=10`, {
    headers: auth(),
  });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).meta, {
    page: 1,
    limit: 10,
    total: 1,
  });

  const invalidSkip = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Shipped" }),
  });
  assert.equal(invalidSkip.status, 409);

  const processing = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Processing" }),
  });
  assert.equal(processing.status, 200);
  assert.equal((await processing.json()).order.status, "Processing");

  const retryProcessing = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Processing" }),
  });
  assert.equal(retryProcessing.status, 200);
  assert.equal((await retryProcessing.json()).order.status, "Processing");

  const shipped = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Shipped" }),
  });
  assert.equal(shipped.status, 200);
  assert.equal((await shipped.json()).order.status, "Shipped");

  const rollback = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Processing" }),
  });
  assert.equal(rollback.status, 409);

  const delivered = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Delivered" }),
  });
  assert.equal(delivered.status, 200);
  assert.equal((await delivered.json()).order.status, "Delivered");

  const rollbackDelivered = await fetch(`${baseUrl}/orders/${order.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Shipped" }),
  });
  assert.equal(rollbackDelivered.status, 409);

  const retryAfterStatusUpdate = await create(order);
  assert.equal(retryAfterStatusUpdate.status, 200);
  assert.equal((await retryAfterStatusUpdate.json()).order.status, "Delivered");

  const isolatedRead = await fetch(`${baseUrl}/orders/${order.id}`, {
    headers: auth(otherApiKey),
  });
  assert.equal(isolatedRead.status, 404);

  const cancellableOrder = {
    ...order,
    id: "ORD-550e8400-e29b-41d4-a716-446655440099",
  };
  assert.equal((await create(cancellableOrder)).status, 201);
  const cancelled = await fetch(`${baseUrl}/orders/${cancellableOrder.id}`, {
    method: "PATCH",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ status: "Cancelled" }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).order.status, "Cancelled");

  const retryCancellation = await fetch(
    `${baseUrl}/orders/${cancellableOrder.id}`,
    {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    },
  );
  assert.equal(retryCancellation.status, 200);
  assert.equal((await retryCancellation.json()).order.status, "Cancelled");

  const advanceCancelled = await fetch(
    `${baseUrl}/orders/${cancellableOrder.id}`,
    {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ status: "Processing" }),
    },
  );
  assert.equal(advanceCancelled.status, 409);
});

test("upgrades an existing SQLite order status constraint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tenant-schema-upgrade-"));
  const databaseFile = join(directory, "tenant.sqlite");
  const legacy = new DatabaseSync(databaseFile);
  legacy.exec(`
    CREATE TABLE orders (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('Confirmed', 'Processing', 'Shipped', 'Cancelled')
      ),
      created_at TEXT NOT NULL,
      items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array'),
      total INTEGER NOT NULL CHECK (total >= 0),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      item_count INTEGER NOT NULL CHECK (item_count > 0),
      PRIMARY KEY (tenant_id, id)
    );
    INSERT INTO orders VALUES (
      'tenant-upgrade',
      'ORD-550e8400-e29b-41d4-a716-446655440099',
      'customer-upgrade',
      'Shipped',
      '2026-10-22T12:00:00.000Z',
      '[]',
      0,
      'USD',
      1
    );
  `);
  legacy.close();

  const upgraded = await createSqliteProductRepository(databaseFile);
  try {
    assert.equal(upgraded.health().schemaVersion, "9");
    assert.equal(
      upgraded.getOrder(
        "tenant-upgrade",
        "ORD-550e8400-e29b-41d4-a716-446655440099",
      ).subtotal,
      undefined,
    );
    assert.equal(
      upgraded.updateOrderStatus(
        "tenant-upgrade",
        "ORD-550e8400-e29b-41d4-a716-446655440099",
        "Delivered",
      ).status,
      "Delivered",
    );
  } finally {
    upgraded.close();
    await rm(directory, { recursive: true, force: true });
  }
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
