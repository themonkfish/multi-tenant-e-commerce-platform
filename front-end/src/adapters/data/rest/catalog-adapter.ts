import "server-only";
import { z } from "zod";
import type {
  Paginated,
  Product,
  ProductInput,
  ProductQuery,
  CatalogPort,
} from "@/core/ports/data";
import { TenantDataBackendError } from "@/core/ports/data";
import { ProductInputSchema, ProductUpdateSchema } from "@/core/domain/product";
import type { TenantRestDataProviderConfig } from "@/core/domain/tenant-config";
import {
  requestSafeRestBackend,
  type RestHttpRequest,
  type RestHttpResponse,
} from "./safe-http";

const MoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/),
});

const ProductSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  tenantId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  price: MoneySchema,
  sku: z.string().optional(),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const PageSchema = z.object({
  data: z.array(ProductSchema),
  meta: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});

const MAX_PAGE_SIZE = 100;

export class RestBackendError extends TenantDataBackendError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "RestBackendError";
  }
}

type RestTransport = (
  config: TenantRestDataProviderConfig,
  apiKey: string,
  request: RestHttpRequest,
) => Promise<RestHttpResponse>;

export class RestCatalogAdapter implements CatalogPort {
  constructor(
    private readonly config: TenantRestDataProviderConfig,
    private readonly apiKey: string,
    private readonly tenantId: string,
    private readonly transport: RestTransport = requestSafeRestBackend,
  ) {
    if (!tenantId) {
      throw new Error(
        "A tenant scope is required for the REST catalog adapter",
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
      query.limit > MAX_PAGE_SIZE
    ) {
      throw new Error(
        `Product pagination must use page >= 1 and limit 1-${MAX_PAGE_SIZE}`,
      );
    }
    const response = await this.request({
      method: "GET",
      path: "/products",
      query: new URLSearchParams({
        page: String(query.page),
        limit: String(query.limit),
        tenantId: this.tenantId,
      }),
    });
    const page = PageSchema.parse(response.body);
    return {
      data: page.data.map((product) => this.parseProduct(product)),
      meta: page.meta,
    };
  }

  async getProduct(tenantId: string, id: string): Promise<Product> {
    this.assertTenant(tenantId);
    const response = await this.request({
      method: "GET",
      path: `/products/${this.productId(id)}`,
    });
    return this.parseProduct(ProductSchema.parse(response.body));
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const { tenantId, ...fields } = input;
    this.assertTenant(tenantId);
    const response = await this.request({
      method: "POST",
      path: "/products",
      body: { ...ProductInputSchema.parse(fields), tenantId },
    });
    return this.parseProduct(ProductSchema.parse(response.body));
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
    const response = await this.request({
      method: "PATCH",
      path: `/products/${this.productId(id)}`,
      body: ProductUpdateSchema.parse(fields),
    });
    return this.parseProduct(ProductSchema.parse(response.body));
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    this.assertTenant(tenantId);
    await this.request({
      method: "DELETE",
      path: `/products/${this.productId(id)}`,
    });
  }

  private async request(request: RestHttpRequest): Promise<RestHttpResponse> {
    const response = await this.transport(this.config, this.apiKey, request);
    if (response.status < 200 || response.status >= 300) {
      throw new RestBackendError(
        response.status,
        this.errorMessage(response.status),
      );
    }
    return response;
  }

  private parseProduct(value: unknown): Product {
    const product = ProductSchema.parse(value);
    this.assertTenant(product.tenantId);
    return product;
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

  private errorMessage(status: number): string {
    if (status === 401 || status === 403) {
      return "Tenant backend rejected the configured API key";
    }
    if (status === 404) return "Product was not found";
    if (status === 409) return "Tenant backend reported a product conflict";
    if (status === 422) return "Tenant backend rejected the product data";
    if (status === 429) return "Tenant backend rate limit was exceeded";
    if (status >= 500) return "Tenant backend encountered an error";
    return `Tenant backend returned HTTP ${status}`;
  }
}

export function createRestCatalogAdapter(
  config: TenantRestDataProviderConfig,
  apiKey: string,
  tenantId: string,
  transport?: RestTransport,
): CatalogPort {
  return new RestCatalogAdapter(config, apiKey, tenantId, transport);
}
