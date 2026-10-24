import "server-only";
import { randomUUID } from "node:crypto";
import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Db,
  type Document,
  type ClientSession,
} from "mongodb";
import { z } from "zod";
import {
  ProductInputSchema,
  ProductOptionsSchema,
  ProductVariantSelectionsSchema,
  ProductUpdateSchema,
  ProductVariantsSchema,
} from "@/core/domain/product";
import type { TenantDatabaseProviderConfig } from "@/core/domain/tenant-config";
import type {
  CatalogPort,
  InventoryReservationItem,
  Paginated,
  Product,
  ProductInput,
  ProductQuery,
} from "@/core/ports/data";
import { TenantDataBackendError } from "@/core/ports/data";
import {
  TENANT_CATALOG_SCHEMA_VERSION,
  type TenantDatabaseAdapter,
} from "../database/tenant-database-adapter";

const ProductDocumentSchema = z.object({
  _id: z.string().min(1),
  tenantId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  price: z.object({
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
  sku: z.string().optional(),
  category: z.string().min(1).max(80).nullable().optional(),
  options: ProductOptionsSchema.optional(),
  variants: ProductVariantsSchema.optional(),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const SchemaMetadataSchema = z.object({
  version: z.number().int().nonnegative(),
  tenantId: z.string().min(1),
});

const PRODUCT_COLLECTION = "tenant_products";
const METADATA_COLLECTION = "tenant_schema_metadata";
const RESERVATIONS_COLLECTION = "tenant_inventory_reservations";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type TenantProductDocument = {
  [key: string]: unknown;
  _id: string;
  tenantId: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  price: { amount: number; currency: string };
  sku?: string;
  category?: string | null;
  options?: { name: string; values: string[] }[];
  variants?: { selections: Record<string, string>; stock: number }[];
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

type TenantSchemaMetadataDocument = {
  [key: string]: unknown;
  _id: string;
  version: number;
  updatedAt?: Date;
  createdAt?: Date;
};

type InventoryReservationDocument = {
  _id: string;
  tenantId: string;
  status: "reserved" | "released" | "committed";
  items: InventoryReservationItem[];
  createdAt: Date;
  updatedAt?: Date;
};

function sameInventoryItems(
  left: InventoryReservationItem[],
  right: InventoryReservationItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.productId === other.productId &&
        item.quantity === other.quantity &&
        JSON.stringify(
          Object.entries(item.selections).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ) ===
          JSON.stringify(
            Object.entries(other.selections).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          )
      );
    })
  );
}

export function validateMongoConnectionString(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid MongoDB connection string");
  }
  const hostname = url.hostname.toLowerCase();
  const unsafeTlsOption = Array.from(url.searchParams.entries()).some(
    ([key, value]) => {
      const normalizedKey = key.toLowerCase();
      return (
        (["tls", "ssl"].includes(normalizedKey) &&
          value.toLowerCase() === "false") ||
        ["tlsinsecure", "sslinsecure"].includes(normalizedKey) ||
        ["tlsallowinvalidcertificates", "sslallowinvalidcertificates"].includes(
          normalizedKey,
        ) ||
        ["tlsallowinvalidhostnames", "sslallowinvalidhostnames"].includes(
          normalizedKey,
        )
      );
    },
  );
  if (
    url.protocol !== "mongodb+srv:" ||
    !hostname.endsWith(".mongodb.net") ||
    hostname === "mongodb.net" ||
    url.port ||
    url.pathname !== "/" ||
    url.hash ||
    unsafeTlsOption
  ) {
    throw new Error("Only secure MongoDB Atlas SRV endpoints are supported");
  }
  return url;
}

export class MongoTenantCatalog implements CatalogPort {
  constructor(
    private readonly connectionString: string,
    private readonly dbName: string,
    private readonly tenantId: string,
  ) {
    validateMongoConnectionString(connectionString);
    if (!tenantId) {
      throw new Error(
        "A tenant scope is required for the MongoDB catalog adapter",
      );
    }
  }

  async listProducts(query: ProductQuery): Promise<Paginated<Product>> {
    this.assertTenant(query.tenantId);
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new Error("Product pagination must use page >= 1 and limit 1-100");
    }
    const offset = (query.page - 1) * query.limit;
    if (!Number.isSafeInteger(offset)) {
      throw new Error(
        "Product pagination offset is outside the supported range",
      );
    }
    return this.withCollection(async (collection) => {
      const filter: Document = { tenantId: this.tenantId };
      if (query.search?.trim()) {
        filter.title = {
          $regex: escapeRegex(query.search.trim()),
          $options: "i",
        };
      }
      if (query.category) filter.category = query.category;
      if (query.status) filter.status = query.status;
      const [documents, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(query.limit)
          .toArray(),
        collection.countDocuments(filter),
      ]);
      return {
        data: documents.map((document) => this.mapProduct(document)),
        meta: { page: query.page, limit: query.limit, total },
      };
    });
  }

  async listProductCategories(
    tenantId: string,
    status?: Product["status"],
  ): Promise<string[]> {
    this.assertTenant(tenantId);
    return this.withCollection(async (collection) => {
      const values = await collection.distinct("category", {
        tenantId: this.tenantId,
        category: { $type: "string" },
        ...(status ? { status } : {}),
      });
      return Array.from(
        new Set(values.map((value) => z.string().min(1).max(80).parse(value))),
      ).sort((left, right) => left.localeCompare(right));
    });
  }

  async getProduct(tenantId: string, id: string): Promise<Product> {
    this.assertTenant(tenantId);
    return this.withCollection(async (collection) => {
      const document = await collection.findOne({
        _id: this.productId(id),
        tenantId: this.tenantId,
      });
      if (!document) throw new TenantDataBackendError(404, "Product not found");
      return this.mapProduct(document);
    });
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const { tenantId, ...fields } = input;
    this.assertTenant(tenantId);
    const product = ProductInputSchema.parse(fields);
    const now = new Date().toISOString();
    const document = {
      _id: randomUUID(),
      tenantId: this.tenantId,
      ...product,
      createdAt: now,
      updatedAt: now,
    };
    return this.withCollection(async (collection) => {
      await collection.insertOne(document);
      return this.mapProduct(document);
    });
  }

  async updateProduct(
    tenantId: string,
    id: string,
    input: Partial<ProductInput>,
  ): Promise<Product> {
    this.assertTenant(tenantId);
    const fields = { ...input };
    if (fields.tenantId !== undefined) {
      this.assertTenant(fields.tenantId);
      delete fields.tenantId;
    }
    const update = ProductUpdateSchema.parse(fields);
    return this.withCollection(async (collection) => {
      const set: Document = { ...update, updatedAt: new Date().toISOString() };
      const unset: Document = {};
      if (update.sku === undefined && Object.hasOwn(fields, "sku")) {
        delete set.sku;
        unset.sku = "";
      }
      const result = await collection.updateOne(
        { _id: this.productId(id), tenantId: this.tenantId },
        {
          $set: set,
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        },
      );
      if (result.matchedCount === 0) {
        throw new TenantDataBackendError(404, "Product not found");
      }
      const document = await collection.findOne({
        _id: this.productId(id),
        tenantId: this.tenantId,
      });
      if (!document) throw new TenantDataBackendError(404, "Product not found");
      return this.mapProduct(document);
    });
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    this.assertTenant(tenantId);
    await this.withCollection(async (collection) => {
      const result = await collection.deleteOne({
        _id: this.productId(id),
        tenantId: this.tenantId,
      });
      if (result.deletedCount === 0) {
        throw new TenantDataBackendError(404, "Product not found");
      }
    });
  }

  async reserveInventory(input: {
    reservationId: string;
    items: InventoryReservationItem[];
  }): Promise<boolean> {
    const reservationId = this.reservationId(input.reservationId);
    const items = z
      .array(
        z.object({
          productId: z.string().min(1).max(128),
          selections: ProductVariantSelectionsSchema,
          quantity: z.number().int().positive().max(100),
        }),
      )
      .min(1)
      .max(20)
      .parse(input.items);
    return this.withClient(async (client, db) => {
      const session = client.startSession();
      try {
        let reserved = false;
        await session.withTransaction(async () => {
          const reservations = db.collection<InventoryReservationDocument>(
            RESERVATIONS_COLLECTION,
          );
          const prior = await reservations.findOne(
            { _id: reservationId, tenantId: this.tenantId },
            { session },
          );
          if (prior) {
            reserved =
              (prior.status === "reserved" || prior.status === "committed") &&
              sameInventoryItems(prior.items, items);
            return;
          }
          for (const item of items) {
            const changed = await this.adjustInventoryStock(
              db,
              session,
              item,
              -item.quantity,
            );
            if (!changed) {
              throw new Error("insufficient_inventory");
            }
          }
          await reservations.insertOne(
            {
              _id: reservationId,
              tenantId: this.tenantId,
              status: "reserved",
              items,
              createdAt: new Date(),
            },
            { session },
          );
          reserved = true;
        });
        return reserved;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "insufficient_inventory"
        ) {
          return false;
        }
        throw error;
      } finally {
        await session.endSession();
      }
    });
  }

  async releaseInventory(reservationId: string): Promise<void> {
    await this.transitionInventoryReservation(reservationId, "released");
  }

  async commitInventory(reservationId: string): Promise<void> {
    await this.transitionInventoryReservation(reservationId, "committed");
  }

  private async transitionInventoryReservation(
    value: string,
    nextStatus: "released" | "committed",
  ): Promise<void> {
    const reservationId = this.reservationId(value);
    await this.withClient(async (client, db) => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const reservations = db.collection<InventoryReservationDocument>(
            RESERVATIONS_COLLECTION,
          );
          const reservation = await reservations.findOne(
            { _id: reservationId, tenantId: this.tenantId },
            { session },
          );
          if (!reservation || reservation.status !== "reserved") return;
          if (nextStatus === "released") {
            const items = z
              .array(
                z.object({
                  productId: z.string().min(1),
                  selections: ProductVariantSelectionsSchema,
                  quantity: z.number().int().positive(),
                }),
              )
              .parse(reservation.items);
            for (const item of items) {
              const changed = await this.adjustInventoryStock(
                db,
                session,
                item,
                item.quantity,
              );
              if (!changed) {
                throw new TenantDataBackendError(
                  409,
                  "Reserved inventory variant no longer exists",
                );
              }
            }
          }
          await reservations.updateOne(
            { _id: reservationId, tenantId: this.tenantId, status: "reserved" },
            { $set: { status: nextStatus, updatedAt: new Date() } },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
    });
  }

  async checkConnection(): Promise<number | null> {
    return this.withClient(async (client, db) => {
      await db.command({ ping: 1 });
      return this.getSchemaVersionFromDb(db);
    });
  }

  private async adjustInventoryStock(
    db: Db,
    session: ClientSession,
    item: InventoryReservationItem,
    delta: number,
  ): Promise<boolean> {
    const collection = db.collection<TenantProductDocument>(PRODUCT_COLLECTION);
    const product = await collection.findOne(
      { _id: this.productId(item.productId), tenantId: this.tenantId },
      { session },
    );
    if (!product?.variants) return false;
    const index = product.variants.findIndex(
      (variant) =>
        JSON.stringify(
          Object.entries(variant.selections).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ) ===
        JSON.stringify(
          Object.entries(item.selections).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
    );
    if (index < 0) return false;
    const stock = product.variants[index].stock + delta;
    if (stock < 0 || stock > 1_000_000) return false;
    const variants = product.variants.map((variant, variantIndex) =>
      variantIndex === index ? { ...variant, stock } : variant,
    );
    const result = await collection.updateOne(
      { _id: product._id, tenantId: this.tenantId },
      { $set: { variants } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async getSchemaVersion(): Promise<number | null> {
    return this.withClient((_client, db) => this.getSchemaVersionFromDb(db));
  }

  async initializeSchema(): Promise<number> {
    return this.withClient(async (_client, db) => {
      const metadata =
        db.collection<TenantSchemaMetadataDocument>(METADATA_COLLECTION);
      const current = await metadata.findOne({ _id: "tenant-catalog" });
      const parsedMetadata = current
        ? SchemaMetadataSchema.parse(current)
        : null;
      if (parsedMetadata && parsedMetadata.tenantId !== this.tenantId) {
        throw new TenantDataBackendError(
          409,
          "This MongoDB database is initialized for another tenant",
        );
      }
      const currentVersion = parsedMetadata?.version ?? 0;
      if (currentVersion > TENANT_CATALOG_SCHEMA_VERSION) {
        throw new TenantDataBackendError(
          409,
          "Tenant database schema is newer than this platform supports",
        );
      }
      const productCollectionExists = await db
        .listCollections({ name: PRODUCT_COLLECTION }, { nameOnly: true })
        .hasNext();
      const productValidator = {
        $jsonSchema: {
          bsonType: "object",
          required: [
            "_id",
            "tenantId",
            "title",
            "slug",
            "status",
            "price",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            _id: { bsonType: "string" },
            tenantId: { bsonType: "string" },
            title: { bsonType: "string", minLength: 1, maxLength: 200 },
            slug: { bsonType: "string", minLength: 1, maxLength: 200 },
            status: { enum: ["draft", "active", "archived"] },
            price: {
              bsonType: "object",
              required: ["amount", "currency"],
              properties: {
                amount: {
                  bsonType: ["int", "long", "double"],
                  minimum: 0,
                  multipleOf: 1,
                },
                currency: { bsonType: "string", pattern: "^[A-Z]{3}$" },
              },
            },
            sku: { bsonType: "string", maxLength: 100 },
            category: {
              bsonType: ["string", "null"],
              minLength: 1,
              maxLength: 80,
            },
            options: {
              bsonType: "array",
              maxItems: 3,
              items: {
                bsonType: "object",
                required: ["name", "values"],
                properties: {
                  name: { bsonType: "string", minLength: 1, maxLength: 40 },
                  values: {
                    bsonType: "array",
                    minItems: 1,
                    maxItems: 20,
                    items: { bsonType: "string", minLength: 1, maxLength: 40 },
                  },
                  variants: {
                    bsonType: "array",
                    minItems: 1,
                    maxItems: 200,
                    items: {
                      bsonType: "object",
                      required: ["selections", "stock"],
                      properties: {
                        selections: { bsonType: "object" },
                        stock: {
                          bsonType: ["int", "long", "double"],
                          minimum: 0,
                          maximum: 1000000,
                          multipleOf: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
            imageUrl: {
              bsonType: ["string", "null"],
              maxLength: 2048,
              pattern: "^https://",
            },
            createdAt: { bsonType: "string" },
            updatedAt: { bsonType: "string" },
          },
        },
      };
      if (!productCollectionExists) {
        try {
          await db.createCollection(PRODUCT_COLLECTION, {
            validator: productValidator,
            validationLevel: "strict",
            validationAction: "error",
          });
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== 48) {
            throw error;
          }
        }
      } else if (currentVersion < TENANT_CATALOG_SCHEMA_VERSION) {
        await db.command({
          collMod: PRODUCT_COLLECTION,
          validator: productValidator,
          validationLevel: "strict",
          validationAction: "error",
        });
      }
      const reservationCollectionExists = await db
        .listCollections({ name: RESERVATIONS_COLLECTION }, { nameOnly: true })
        .hasNext();
      if (!reservationCollectionExists) {
        try {
          await db.createCollection(RESERVATIONS_COLLECTION, {
            validationLevel: "strict",
            validationAction: "error",
          });
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== 48) {
            throw error;
          }
        }
      }
      await db
        .collection<InventoryReservationDocument>(RESERVATIONS_COLLECTION)
        .createIndex({ tenantId: 1, _id: 1 }, { unique: true });
      await db
        .collection(PRODUCT_COLLECTION)
        .createIndex({ tenantId: 1, slug: 1 }, { unique: true });
      await db.collection(PRODUCT_COLLECTION).createIndex({
        tenantId: 1,
        createdAt: -1,
      });
      await metadata.updateOne(
        { _id: "tenant-catalog" },
        {
          $set: {
            tenantId: this.tenantId,
            version: TENANT_CATALOG_SCHEMA_VERSION,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      return TENANT_CATALOG_SCHEMA_VERSION;
    });
  }

  private async getSchemaVersionFromDb(db: Db): Promise<number | null> {
    const exists = await db
      .listCollections({ name: METADATA_COLLECTION }, { nameOnly: true })
      .hasNext();
    if (!exists) return null;
    const metadata = await db
      .collection<TenantSchemaMetadataDocument>(METADATA_COLLECTION)
      .findOne({ _id: "tenant-catalog" });
    if (!metadata) return null;
    const parsedMetadata = SchemaMetadataSchema.parse(metadata);
    if (parsedMetadata.tenantId !== this.tenantId) {
      throw new TenantDataBackendError(
        409,
        "This MongoDB database is initialized for another tenant",
      );
    }
    return parsedMetadata.version;
  }

  private async withCollection<T>(
    operation: (collection: Collection<TenantProductDocument>) => Promise<T>,
  ): Promise<T> {
    return this.withClient((_client, db) =>
      operation(db.collection<TenantProductDocument>(PRODUCT_COLLECTION)),
    );
  }

  private async withClient<T>(
    operation: (client: MongoClient, db: Db) => Promise<T>,
  ): Promise<T> {
    const client = new MongoClient(this.connectionString, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      tls: true,
    });
    try {
      await client.connect();
      return await operation(client, client.db(this.dbName));
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new TenantDataBackendError(
          409,
          "A product with the same tenant-scoped slug already exists",
        );
      }
      throw error;
    } finally {
      await client.close();
    }
  }

  private mapProduct(value: unknown): Product {
    const product = ProductDocumentSchema.parse(value);
    if (product.tenantId !== this.tenantId) {
      throw new TenantDataBackendError(
        502,
        "Tenant backend returned invalid data",
      );
    }
    return {
      id: product._id,
      tenantId: product.tenantId,
      title: product.title,
      slug: product.slug,
      status: product.status,
      price: product.price,
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.category === undefined ? {} : { category: product.category }),
      ...(product.options === undefined ? {} : { options: product.options }),
      ...(product.variants === undefined ? {} : { variants: product.variants }),
      ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) {
      throw new Error(
        "Product operation is outside the configured tenant scope",
      );
    }
  }

  private productId(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new Error("Product ID contains unsupported characters");
    }
    return id;
  }

  private reservationId(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new Error(
        "Inventory reservation ID contains unsupported characters",
      );
    }
    return id;
  }
}

export function createMongoTenantDatabaseAdapter(
  config: Extract<TenantDatabaseProviderConfig, { type: "mongodb" }>,
  connectionString: string,
  tenantId: string,
): TenantDatabaseAdapter {
  const catalog = new MongoTenantCatalog(
    connectionString,
    config.dbName,
    tenantId,
  );
  return {
    catalog,
    checkConnection: () => catalog.checkConnection(),
    getSchemaVersion: () => catalog.getSchemaVersion(),
    initializeSchema: () => catalog.initializeSchema(),
  };
}
