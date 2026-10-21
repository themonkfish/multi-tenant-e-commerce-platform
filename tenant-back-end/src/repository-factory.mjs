import { createSqliteProductRepository } from "./sqlite-product-repository.mjs";

export async function createProductRepository(config) {
  switch (config.databaseProvider) {
    case "sqlite":
      return createSqliteProductRepository(config.databaseFile);
    default:
      throw new Error(
        `No product repository is registered for "${config.databaseProvider}"`,
      );
  }
}
