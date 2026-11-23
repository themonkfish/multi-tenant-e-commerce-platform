import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

const SCHEMA_VERSION = "10";

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
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.image_url === null ? {} : { imageUrl: row.image_url }),
    ...(row.options_json === null
      ? {}
      : { options: JSON.parse(row.options_json) }),
    ...(row.variants_json === null
      ? {}
      : { variants: JSON.parse(row.variants_json) }),
    ...(row.variant_pricing_json === null
      ? {}
      : { variantPricing: JSON.parse(row.variant_pricing_json) }),
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
      category TEXT,
      image_url TEXT,
      options_json TEXT,
      variants_json TEXT,
      variant_pricing_json TEXT,
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
      status TEXT NOT NULL CHECK (
        status IN ('Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled')
      ),
      created_at TEXT NOT NULL,
      items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array'),
      total INTEGER NOT NULL CHECK (total >= 0),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      item_count INTEGER NOT NULL CHECK (item_count > 0),
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      tenant_id TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('reserved', 'released', 'committed', 'restored')
      ),
      items_json TEXT NOT NULL CHECK (
        json_valid(items_json) AND json_type(items_json) = 'array'
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, reservation_id)
    );
    CREATE INDEX IF NOT EXISTS orders_tenant_created
      ON orders (tenant_id, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const orderTable = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
    )
    .get();
  if (
    !orderTable.sql.includes("'Cancelled'") ||
    !orderTable.sql.includes("'Delivered'")
  ) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE orders RENAME TO orders_before_cancellation;
      CREATE TABLE orders (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled')
        ),
        created_at TEXT NOT NULL,
        items_json TEXT NOT NULL CHECK (
          json_valid(items_json) AND json_type(items_json) = 'array'
        ),
        total INTEGER NOT NULL CHECK (total >= 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        item_count INTEGER NOT NULL CHECK (item_count > 0),
        PRIMARY KEY (tenant_id, id)
      );
      INSERT INTO orders
        (tenant_id, id, customer_id, status, created_at, items_json, total, currency, item_count)
      SELECT
        tenant_id, id, customer_id, status, created_at, items_json, total, currency, item_count
      FROM orders_before_cancellation;
      DROP TABLE orders_before_cancellation;
      CREATE INDEX IF NOT EXISTS orders_tenant_created
        ON orders (tenant_id, created_at DESC, id);
      COMMIT;
    `);
  }
  const productColumns = new Set(
    database
      .prepare("PRAGMA table_info(products)")
      .all()
      .map((row) => row.name),
  );
  const productColumnDefinitions = [
    ["category", "TEXT"],
    ["image_url", "TEXT"],
    ["options_json", "TEXT"],
    ["variants_json", "TEXT"],
    ["variant_pricing_json", "TEXT"],
  ];
  for (const [column, definition] of productColumnDefinitions) {
    if (!productColumns.has(column)) {
      database.exec(`ALTER TABLE products ADD COLUMN ${column} ${definition}`);
    }
  }
  const orderColumns = new Set(
    database
      .prepare("PRAGMA table_info(orders)")
      .all()
      .map((row) => row.name),
  );
  const orderColumnDefinitions = [
    ["subtotal", "INTEGER CHECK (subtotal IS NULL OR subtotal >= 0)"],
    [
      "shipping_amount",
      "INTEGER CHECK (shipping_amount IS NULL OR shipping_amount >= 0)",
    ],
    [
      "discount_code",
      "TEXT CHECK (discount_code IS NULL OR length(trim(discount_code)) BETWEEN 3 AND 40)",
    ],
    [
      "discount_amount",
      "INTEGER CHECK (discount_amount IS NULL OR discount_amount >= 0)",
    ],
    [
      "tax_rate_basis_points",
      "INTEGER CHECK (tax_rate_basis_points IS NULL OR tax_rate_basis_points BETWEEN 0 AND 10000)",
    ],
    ["tax_amount", "INTEGER CHECK (tax_amount IS NULL OR tax_amount >= 0)"],
    [
      "payment_method",
      "TEXT CHECK (payment_method IS NULL OR payment_method IN ('stripe', 'cash_on_delivery'))",
    ],
    [
      "delivery_address_json",
      "TEXT CHECK (delivery_address_json IS NULL OR (json_valid(delivery_address_json) AND json_type(delivery_address_json) = 'object'))",
    ],
    [
      "fulfillment_json",
      "TEXT CHECK (fulfillment_json IS NULL OR (json_valid(fulfillment_json) AND json_type(fulfillment_json) = 'object'))",
    ],
  ];
  for (const [column, definition] of orderColumnDefinitions) {
    if (!orderColumns.has(column)) {
      database.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
    }
  }
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
  const selectReservation = database.prepare(
    "SELECT * FROM inventory_reservations WHERE tenant_id = ? AND reservation_id = ?",
  );

  function sameSelections(left, right) {
    const normalize = (value) =>
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }

  function sameReservationItems(left, right) {
    return (
      left.length === right.length &&
      left.every(
        (item, index) =>
          item.productId === right[index].productId &&
          item.quantity === right[index].quantity &&
          sameSelections(item.selections, right[index].selections),
      )
    );
  }

  function adjustInventoryStock(tenantId, item, delta) {
    const product = toProduct(selectProduct.get(tenantId, item.productId));
    if (!product?.variants) return false;
    const index = product.variants.findIndex((variant) =>
      sameSelections(variant.selections, item.selections),
    );
    if (index < 0) return false;
    const stock = product.variants[index].stock + delta;
    if (stock < 0 || stock > 1_000_000) return false;
    const variants = product.variants.map((variant, variantIndex) =>
      variantIndex === index ? { ...variant, stock } : variant,
    );
    database
      .prepare(
        "UPDATE products SET variants_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      )
      .run(
        JSON.stringify(variants),
        new Date().toISOString(),
        tenantId,
        item.productId,
      );
    return true;
  }

  function reserveInventory({ tenantId, reservationId, items }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const prior = selectReservation.get(tenantId, reservationId);
      if (prior) {
        const sameItems = sameReservationItems(
          JSON.parse(prior.items_json),
          items,
        );
        database.exec("COMMIT");
        return {
          reserved:
            sameItems &&
            (prior.status === "reserved" || prior.status === "committed"),
        };
      }
      for (const item of items) {
        if (!adjustInventoryStock(tenantId, item, -item.quantity)) {
          database.exec("ROLLBACK");
          return { reserved: false };
        }
      }
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO inventory_reservations
           (tenant_id, reservation_id, status, items_json, created_at, updated_at)
           VALUES (?, ?, 'reserved', ?, ?, ?)`,
        )
        .run(tenantId, reservationId, JSON.stringify(items), now, now);
      database.exec("COMMIT");
      return { reserved: true };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function transitionInventoryReservation({ tenantId, reservationId, action }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const reservation = selectReservation.get(tenantId, reservationId);
      if (!reservation) {
        database.exec("ROLLBACK");
        return null;
      }
      const transition = {
        release: { from: "reserved", to: "released", restoreStock: true },
        commit: { from: "reserved", to: "committed", restoreStock: false },
        restore: { from: "committed", to: "restored", restoreStock: true },
      }[action];
      if (reservation.status !== transition.from) {
        database.exec("COMMIT");
        return { status: reservation.status };
      }
      if (transition.restoreStock) {
        for (const item of JSON.parse(reservation.items_json)) {
          if (!adjustInventoryStock(tenantId, item, item.quantity)) {
            throw new Error("Inventory variant could not be restored");
          }
        }
      }
      database
        .prepare(
          `UPDATE inventory_reservations
           SET status = ?, updated_at = ?
           WHERE tenant_id = ? AND reservation_id = ? AND status = ?`,
        )
        .run(
          transition.to,
          new Date().toISOString(),
          tenantId,
          reservationId,
          transition.from,
        );
      database.exec("COMMIT");
      return { status: transition.to };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

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
      ...(row.subtotal === null ? {} : { subtotal: row.subtotal }),
      ...(row.shipping_amount === null
        ? {}
        : { shippingAmount: row.shipping_amount }),
      ...(row.discount_code === null
        ? {}
        : { discountCode: row.discount_code }),
      ...(row.discount_amount === null
        ? {}
        : { discountAmount: row.discount_amount }),
      ...(row.tax_rate_basis_points === null
        ? {}
        : { taxRateBasisPoints: row.tax_rate_basis_points }),
      ...(row.tax_amount === null ? {} : { taxAmount: row.tax_amount }),
      ...(row.payment_method === null
        ? {}
        : { paymentMethod: row.payment_method }),
      ...(row.delivery_address_json === null
        ? {}
        : { deliveryAddress: JSON.parse(row.delivery_address_json) }),
      ...(row.fulfillment_json === null
        ? {}
        : { fulfillment: JSON.parse(row.fulfillment_json) }),
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
           (tenant_id, id, customer_id, status, created_at, items_json, total, currency, item_count,
            subtotal, shipping_amount, discount_code, discount_amount, tax_rate_basis_points,
            tax_amount, payment_method, delivery_address_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          order.subtotal ?? null,
          order.shippingAmount ?? null,
          order.discountCode ?? null,
          order.discountAmount ?? null,
          order.taxRateBasisPoints ?? null,
          order.taxAmount ?? null,
          order.paymentMethod ?? null,
          order.deliveryAddress ? JSON.stringify(order.deliveryAddress) : null,
        );
      const saved = toOrder(selectOrder.get(order.tenantId, order.id));
      if (!saved) {
        throw new Error("Tenant backend failed to persist the order");
      }
      const originalSnapshot = { ...saved, status: "Confirmed" };
      delete originalSnapshot.fulfillment;
      return {
        order: saved,
        created: result.changes > 0,
        conflict: !isDeepStrictEqual(originalSnapshot, order),
      };
    },

    getOrder(tenantId, id) {
      return toOrder(selectOrder.get(tenantId, id));
    },

    reserveInventory,

    transitionInventoryReservation,

    listOrders({ tenantId, page, limit }) {
      const offset = (page - 1) * limit;
      const rows = database
        .prepare(
          `SELECT * FROM orders
           WHERE tenant_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(tenantId, limit, offset);
      const { total } = database
        .prepare("SELECT count(*) AS total FROM orders WHERE tenant_id = ?")
        .get(tenantId);
      return {
        data: rows.map(toOrder),
        meta: { page, limit, total },
      };
    },

    updateOrderStatus(tenantId, id, status, fulfillment) {
      const current = toOrder(selectOrder.get(tenantId, id));
      if (!current) return null;
      if (fulfillment) {
        database
          .prepare(
            "UPDATE orders SET status = ?, fulfillment_json = ? WHERE tenant_id = ? AND id = ?",
          )
          .run(status, JSON.stringify(fulfillment), tenantId, id);
      } else {
        database
          .prepare(
            "UPDATE orders SET status = ? WHERE tenant_id = ? AND id = ?",
          )
          .run(status, tenantId, id);
      }
      return toOrder(selectOrder.get(tenantId, id));
    },

    createProduct({
      id,
      tenantId,
      title,
      slug,
      status,
      price,
      sku,
      category,
      imageUrl,
      options,
      variants,
      variantPricing,
      now,
    }) {
      database
        .prepare(
          `INSERT INTO products
           (id, tenant_id, title, slug, status, price_amount, price_currency, sku,
            category, image_url, options_json, variants_json, variant_pricing_json,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          category ?? null,
          imageUrl ?? null,
          options ? JSON.stringify(options) : null,
          variants ? JSON.stringify(variants) : null,
          variantPricing ? JSON.stringify(variantPricing) : null,
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
      const category = Object.hasOwn(fields, "category")
        ? (fields.category ?? null)
        : (current.category ?? null);
      const imageUrl = Object.hasOwn(fields, "imageUrl")
        ? (fields.imageUrl ?? null)
        : (current.imageUrl ?? null);
      const options = Object.hasOwn(fields, "options")
        ? fields.options
        : current.options;
      const variants = Object.hasOwn(fields, "variants")
        ? fields.variants
        : current.variants;
      const variantPricing = Object.hasOwn(fields, "variantPricing")
        ? fields.variantPricing
        : current.variantPricing;

      database
        .prepare(
          `UPDATE products SET
             title = ?, slug = ?, status = ?, price_amount = ?,
             price_currency = ?, sku = ?, category = ?, image_url = ?,
             options_json = ?, variants_json = ?, variant_pricing_json = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .run(
          updated.title,
          updated.slug,
          updated.status,
          updated.price.amount,
          updated.price.currency,
          sku,
          category,
          imageUrl,
          options ? JSON.stringify(options) : null,
          variants ? JSON.stringify(variants) : null,
          variantPricing ? JSON.stringify(variantPricing) : null,
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
