import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = "2";

function toProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    price: {
      amount: row.price_amount,
      currency: row.price_currency,
    },
    ...(row.sku === null ? {} : { sku: row.sku }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSqliteProductRepository(databaseFile) {
  if (databaseFile !== ":memory:") {
    await mkdir(dirname(databaseFile), { recursive: true });
  }

  const database = new DatabaseSync(databaseFile);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
      price_amount INTEGER NOT NULL CHECK (price_amount >= 0),
      price_currency TEXT NOT NULL CHECK (length(price_currency) = 3),
      sku TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, slug)
    );
    CREATE INDEX IF NOT EXISTS products_tenant_created
      ON products (tenant_id, created_at, id);
    CREATE TABLE IF NOT EXISTS orders (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Confirmed', 'Processing', 'Shipped')),
      created_at TEXT NOT NULL,
      items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array'),
      total INTEGER NOT NULL CHECK (total >= 0),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      item_count INTEGER NOT NULL CHECK (item_count > 0),
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS orders_tenant_created
      ON orders (tenant_id, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    )
    .run(SCHEMA_VERSION, new Date().toISOString());

  const selectProduct = database.prepare(
    "SELECT * FROM products WHERE tenant_id = ? AND id = ?",
  );
  const selectOrder = database.prepare(
    "SELECT * FROM orders WHERE tenant_id = ? AND id = ?",
  );

  function toOrder(row) {
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      status: row.status,
      createdAt: row.created_at,
      items: JSON.parse(row.items_json),
      total: row.total,
      currency: row.currency,
      itemCount: row.item_count,
    };
  }

  return {
    health() {
      database.prepare("SELECT 1").get();
      return { status: "up", schemaVersion: SCHEMA_VERSION };
    },

    listProducts({ tenantId, page, limit }) {
      const offset = (page - 1) * limit;
      const rows = database
        .prepare(
          `SELECT * FROM products
           WHERE tenant_id = ?
           ORDER BY created_at DESC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(tenantId, limit, offset);
      const { total } = database
        .prepare("SELECT count(*) AS total FROM products WHERE tenant_id = ?")
        .get(tenantId);
      return {
        data: rows.map(toProduct),
        meta: { page, limit, total },
      };
    },

    getProduct(tenantId, id) {
      return toProduct(selectProduct.get(tenantId, id));
    },

    createOrder(order) {
      const result = database
        .prepare(
          `INSERT OR IGNORE INTO orders
           (tenant_id, id, customer_id, status, created_at, items_json, total, currency, item_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.tenantId,
          order.id,
          order.customerId,
          order.status,
          order.createdAt,
          JSON.stringify(order.items),
          order.total,
          order.currency,
          order.itemCount,
        );
      const saved = toOrder(selectOrder.get(order.tenantId, order.id));
      if (!saved) {
        throw new Error("Tenant backend failed to persist the order");
      }
      return {
        order: saved,
        created: result.changes > 0,
        conflict: JSON.stringify(saved) !== JSON.stringify(order),
      };
    },

    getOrder(tenantId, id) {
      return toOrder(selectOrder.get(tenantId, id));
    },

    createProduct({ id, tenantId, title, slug, status, price, sku, now }) {
      database
        .prepare(
          `INSERT INTO products
           (id, tenant_id, title, slug, status, price_amount, price_currency, sku, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          tenantId,
          title.trim(),
          slug,
          status,
          price.amount,
          price.currency,
          sku ?? null,
          now,
          now,
        );
      return toProduct(selectProduct.get(tenantId, id));
    },

    seedProducts(tenantId, products) {
      const insert = database.prepare(
        `INSERT INTO products
         (id, tenant_id, title, slug, status, price_amount, price_currency, sku, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        const { total } = database
          .prepare("SELECT count(*) AS total FROM products WHERE tenant_id = ?")
          .get(tenantId);
        if (total > 0) {
          throw new Error(`Tenant ${tenantId} already has products`);
        }

        for (const product of products) {
          insert.run(
            product.id,
            tenantId,
            product.title.trim(),
            product.slug,
            product.status,
            product.price.amount,
            product.price.currency,
            product.sku ?? null,
            product.createdAt,
            product.updatedAt,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return products.length;
    },

    updateProduct(tenantId, id, fields, now) {
      const current = toProduct(selectProduct.get(tenantId, id));
      if (!current) return null;
      const updated = {
        ...current,
        ...fields,
        title: fields.title?.trim() ?? current.title,
        price: fields.price ?? current.price,
        updatedAt: now,
      };
      const sku = Object.hasOwn(fields, "sku")
        ? (fields.sku ?? null)
        : (current.sku ?? null);

      database
        .prepare(
          `UPDATE products SET
             title = ?, slug = ?, status = ?, price_amount = ?,
             price_currency = ?, sku = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .run(
          updated.title,
          updated.slug,
          updated.status,
          updated.price.amount,
          updated.price.currency,
          sku,
          now,
          tenantId,
          id,
        );
      return toProduct(selectProduct.get(tenantId, id));
    },

    deleteProduct(tenantId, id) {
      return (
        database
          .prepare("DELETE FROM products WHERE tenant_id = ? AND id = ?")
          .run(tenantId, id).changes > 0
      );
    },

    close() {
      database.close();
    },
  };
}
