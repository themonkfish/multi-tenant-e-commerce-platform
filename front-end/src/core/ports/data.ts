export type Money = {
  amount: number;
  currency: string;
};

export type ProductOption = {
  name: string;
  values: string[];
};

export type ProductVariant = {
  selections: Record<string, string>;
  stock: number;
};

export type InventoryReservationItem = {
  productId: string;
  selections: Record<string, string>;
  quantity: number;
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
  options?: ProductOption[];
  variants?: ProductVariant[];
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
  reserveInventory(input: {
    reservationId: string;
    items: InventoryReservationItem[];
  }): Promise<boolean>;
  releaseInventory(reservationId: string): Promise<void>;
  commitInventory(reservationId: string): Promise<void>;
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
