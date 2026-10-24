export type Money = {
  amount: number;
  currency: string;
};

export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number };
};

export type Product = {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  price: Money;
  sku?: string;
  category?: string | null;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductQuery = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  category?: string;
  status?: Product["status"];
};

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

export interface CatalogPort {
  listProducts(query: ProductQuery): Promise<Paginated<Product>>;
  getProduct(tenantId: string, id: string): Promise<Product>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(
    tenantId: string,
    id: string,
    input: Partial<ProductInput>,
  ): Promise<Product>;
  deleteProduct(tenantId: string, id: string): Promise<void>;
  listProductCategories(
    tenantId: string,
    status?: Product["status"],
  ): Promise<string[]>;
}

export class TenantDataBackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TenantDataBackendError";
  }
}
