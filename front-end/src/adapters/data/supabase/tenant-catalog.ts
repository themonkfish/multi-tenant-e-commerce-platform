import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ProductInputSchema,
  ProductOptionsSchema,
  ProductVariantPricingListSchema,
  ProductUpdateSchema,
  ProductVariantsSchema,
} from "@/core/domain/product";
import type { TenantDatabaseProviderConfig } from "@/core/domain/tenant-config";
import type {
  CatalogPort,
  Paginated,
  Product,
  ProductInput,
  ProductQuery,
  InventoryReservationItem,
} from "@/core/ports/data";
import { TenantDataBackendError } from "@/core/ports/data";
import {
  TENANT_CATALOG_SCHEMA_VERSION,
  type TenantDatabaseAdapter,
} from "../database/tenant-database-adapter";

const ProductRowSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  price_amount: z.number().int().nonnegative(),
  price_currency: z.string().length(3),
  sku: z.string().nullable(),
  category: z.string().min(1).max(80).nullable(),
  options: ProductOptionsSchema,
  variants: ProductVariantsSchema.nullable(),
  variant_pricing: ProductVariantPricingListSchema.nullable(),
  image_url: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

const SchemaMetadataSchema = z.object({
  version: z.number().int().nonnegative(),
});

const TABLE = "tenant_products";

type SupabaseTenantDatabase = {
  public: {
    Tables: {
      tenant_products: {
        Row: {
          id: string;
          tenant_id: string;
          title: string;
          slug: string;
          status: "draft" | "active" | "archived";
          price_amount: number;
          price_currency: string;
          sku: string | null;
          category: string | null;
          options: { name: string; values: string[] }[];
          variants:
            { selections: Record<string, string>; stock: number }[] | null;
          variant_pricing:
            | {
                selections: Record<string, string>;
                amount?: number;
                sku?: string;
              }[]
            | null;
          image_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          title: string;
          slug: string;
          status: "draft" | "active" | "archived";
          price_amount: number;
          price_currency: string;
          sku?: string | null;
          category?: string | null;
          options?: { name: string; values: string[] }[];
          variants?:
            { selections: Record<string, string>; stock: number }[] | null;
          variant_pricing?:
            | {
                selections: Record<string, string>;
                amount?: number;
                sku?: string;
              }[]
            | null;
          image_url?: string | null;
          created_at: string;
          updated_at: string;
        };
        Update: {
          title?: string;
          slug?: string;
          status?: "draft" | "active" | "archived";
          price_amount?: number;
          price_currency?: string;
          sku?: string | null;
          category?: string | null;
          options?: { name: string; values: string[] }[];
          variants?:
            { selections: Record<string, string>; stock: number }[] | null;
          variant_pricing?:
            | {
                selections: Record<string, string>;
                amount?: number;
                sku?: string;
              }[]
            | null;
          image_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_schema_metadata: {
        Row: {
          id: string;
          tenant_id: string;
          version: number;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          version: number;
          updated_at: string;
        };
        Update: {
          tenant_id?: string;
          version?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      initialize_tenant_catalog: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      list_tenant_product_categories: {
        Args: { p_tenant_id: string; p_status: string | null };
        Returns: { category: string }[];
      };
      reserve_tenant_product_inventory: {
        Args: {
          p_tenant_id: string;
          p_reservation_id: string;
          p_items: InventoryReservationItem[];
        };
        Returns: boolean;
      };
      release_tenant_product_inventory: {
        Args: { p_tenant_id: string; p_reservation_id: string };
        Returns: undefined;
      };
      commit_tenant_product_inventory: {
        Args: { p_tenant_id: string; p_reservation_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export class SupabaseTenantCatalog implements CatalogPort {
  private readonly client;

  constructor(
    private readonly config: Extract<
      TenantDatabaseProviderConfig,
      { type: "supabase" }
    >,
    serviceKey: string,
    private readonly tenantId: string,
  ) {
    this.client = createClient<SupabaseTenantDatabase>(
      config.projectUrl,
      serviceKey,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: "public" },
        global: { headers: { "x-tenant-id": tenantId } },
      },
    );
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
    const from = (query.page - 1) * query.limit;
    if (!Number.isSafeInteger(from)) {
      throw new Error(
        "Product pagination offset is outside the supported range",
      );
    }
    let builder = this.client
      .from(TABLE)
      .select("*", { count: "exact" })
      .eq("tenant_id", this.tenantId)
      .order("created_at", { ascending: false });
    if (query.search?.trim()) {
      builder = builder.ilike(
        "title",
        `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`,
      );
    }
    if (query.category) {
      builder = builder.eq("category", query.category);
    }
    if (query.status) {
      builder = builder.eq("status", query.status);
    }
    const { data, count, error } = await builder.range(
      from,
      from + query.limit - 1,
    );
    if (error) this.throwBackend(error.message, error.code);
    return {
      data: z
        .array(ProductRowSchema)
        .parse(data ?? [])
        .map((row) => this.mapProduct(row)),
      meta: { page: query.page, limit: query.limit, total: count ?? 0 },
    };
  }

  async getProduct(tenantId: string, id: string): Promise<Product> {
    this.assertTenant(tenantId);
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("tenant_id", this.tenantId)
      .eq("id", this.productId(id))
      .maybeSingle();
    if (error) this.throwBackend(error.message, error.code);
    if (!data) throw new TenantDataBackendError(404, "Product not found");
    return this.mapProduct(ProductRowSchema.parse(data));
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const { tenantId, ...fields } = input;
    this.assertTenant(tenantId);
    const product = ProductInputSchema.parse(fields);
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from(TABLE)
      .insert({
        id: randomUUID(),
        tenant_id: this.tenantId,
        title: product.title,
        slug: product.slug,
        status: product.status,
        price_amount: product.price.amount,
        price_currency: product.price.currency,
        sku: product.sku ?? null,
        category: product.category ?? null,
        options: product.options ?? [],
        variants: product.variants ?? null,
        variant_pricing: product.variantPricing ?? null,
        image_url: product.imageUrl ?? null,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (error) this.throwBackend(error.message, error.code);
    return this.mapProduct(ProductRowSchema.parse(data));
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
    const changes: SupabaseTenantDatabase["public"]["Tables"]["tenant_products"]["Update"] =
      {
        updated_at: new Date().toISOString(),
      };
    if (update.title !== undefined) changes.title = update.title;
    if (update.slug !== undefined) changes.slug = update.slug;
    if (update.status !== undefined) changes.status = update.status;
    if (update.price !== undefined) {
      changes.price_amount = update.price.amount;
      changes.price_currency = update.price.currency;
    }
    if (update.sku !== undefined) changes.sku = update.sku;
    if (update.category !== undefined) changes.category = update.category;
    if (update.options !== undefined) changes.options = update.options;
    if (update.variants !== undefined) changes.variants = update.variants;
    if (update.variantPricing !== undefined) {
      changes.variant_pricing = update.variantPricing;
    }
    if (update.imageUrl !== undefined) changes.image_url = update.imageUrl;
    const { data, error } = await this.client
      .from(TABLE)
      .update(changes)
      .eq("tenant_id", this.tenantId)
      .eq("id", this.productId(id))
      .select("*")
      .maybeSingle();
    if (error) this.throwBackend(error.message, error.code);
    if (!data) throw new TenantDataBackendError(404, "Product not found");
    return this.mapProduct(ProductRowSchema.parse(data));
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    this.assertTenant(tenantId);
    const { data, error } = await this.client
      .from(TABLE)
      .delete()
      .eq("tenant_id", this.tenantId)
      .eq("id", this.productId(id))
      .select("id")
      .maybeSingle();
    if (error) this.throwBackend(error.message, error.code);
    if (!data) throw new TenantDataBackendError(404, "Product not found");
  }

  async listProductCategories(
    tenantId: string,
    status?: Product["status"],
  ): Promise<string[]> {
    this.assertTenant(tenantId);
    const { data, error } = await this.client.rpc(
      "list_tenant_product_categories",
      {
        p_tenant_id: this.tenantId,
        p_status: status ?? null,
      },
    );
    if (error) this.throwBackend(error.message, error.code);
    const categories = z
      .array(z.object({ category: z.string().min(1).max(80) }))
      .parse(data ?? [])
      .map(({ category }) => category);
    return Array.from(new Set(categories));
  }

  async reserveInventory(input: {
    reservationId: string;
    items: InventoryReservationItem[];
  }): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      "reserve_tenant_product_inventory",
      {
        p_tenant_id: this.tenantId,
        p_reservation_id: input.reservationId,
        p_items: input.items,
      },
    );
    if (error) {
      if (error.code === "P0001") return false;
      this.throwBackend(error.message, error.code);
    }
    return z.boolean().parse(data);
  }

  async releaseInventory(reservationId: string): Promise<void> {
    const { error } = await this.client.rpc(
      "release_tenant_product_inventory",
      { p_tenant_id: this.tenantId, p_reservation_id: reservationId },
    );
    if (error) this.throwBackend(error.message, error.code);
  }

  async commitInventory(reservationId: string): Promise<void> {
    const { error } = await this.client.rpc("commit_tenant_product_inventory", {
      p_tenant_id: this.tenantId,
      p_reservation_id: reservationId,
    });
    if (error) this.throwBackend(error.message, error.code);
  }

  async getSchemaVersion(): Promise<number | null> {
    const { data, error } = await this.client
      .from("tenant_schema_metadata")
      .select("version")
      .eq("id", "tenant-catalog")
      .eq("tenant_id", this.tenantId)
      .maybeSingle();
    if (error) {
      throw new TenantDataBackendError(502, error.message);
    }
    return data ? SchemaMetadataSchema.parse(data).version : null;
  }

  async initializeSchema(): Promise<number> {
    const { data, error } = await this.client.rpc("initialize_tenant_catalog", {
      p_tenant_id: this.tenantId,
    });
    if (error) throw new TenantDataBackendError(502, error.message);
    const version = z.number().int().nonnegative().parse(data);
    if (version !== TENANT_CATALOG_SCHEMA_VERSION) {
      throw new TenantDataBackendError(409, "Unsupported schema version");
    }
    return version;
  }

  private mapProduct(value: z.infer<typeof ProductRowSchema>): Product {
    if (value.tenant_id !== this.tenantId) {
      throw new TenantDataBackendError(
        502,
        "Tenant backend returned invalid data",
      );
    }
    return {
      id: value.id,
      tenantId: value.tenant_id,
      title: value.title,
      slug: value.slug,
      status: value.status,
      price: { amount: value.price_amount, currency: value.price_currency },
      ...(value.sku === null ? {} : { sku: value.sku }),
      ...(value.category === null ? {} : { category: value.category }),
      options: value.options,
      ...(value.variants === null ? {} : { variants: value.variants }),
      ...(value.variant_pricing === null
        ? {}
        : { variantPricing: value.variant_pricing }),
      ...(value.image_url === null ? {} : { imageUrl: value.image_url }),
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    };
  }

  private assertTenant(tenantId: string): void {
    if (!this.tenantId || tenantId !== this.tenantId) {
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

  private throwBackend(message: string, code?: string): never {
    const status =
      code === "23505"
        ? 409
        : code === "23503" || code === "23514"
          ? 422
          : code === "42501"
            ? 403
            : 502;
    throw new TenantDataBackendError(status, message);
  }
}

export function createSupabaseTenantDatabaseAdapter(
  config: Extract<TenantDatabaseProviderConfig, { type: "supabase" }>,
  serviceKey: string,
  tenantId: string,
): TenantDatabaseAdapter {
  const catalog = new SupabaseTenantCatalog(config, serviceKey, tenantId);
  return {
    catalog,
    checkConnection: () => catalog.getSchemaVersion(),
    getSchemaVersion: () => catalog.getSchemaVersion(),
    initializeSchema: () => catalog.initializeSchema(),
  };
}
