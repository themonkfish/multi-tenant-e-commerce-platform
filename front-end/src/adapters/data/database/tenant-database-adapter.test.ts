import { describe, expect, it } from "vitest";
import {
  classifyTenantDatabaseSchema,
  TENANT_CATALOG_SCHEMA_VERSION,
} from "./tenant-database-adapter";

describe("classifyTenantDatabaseSchema", () => {
  it("reports an uninitialized database", () => {
    expect(classifyTenantDatabaseSchema(null)).toBe("not_initialized");
  });

  it("reports a current database schema", () => {
    expect(classifyTenantDatabaseSchema(TENANT_CATALOG_SCHEMA_VERSION)).toBe(
      "current",
    );
  });

  it("reports older and newer database schemas", () => {
    expect(
      classifyTenantDatabaseSchema(TENANT_CATALOG_SCHEMA_VERSION - 1),
    ).toBe("upgrade_available");
    expect(
      classifyTenantDatabaseSchema(TENANT_CATALOG_SCHEMA_VERSION + 1),
    ).toBe("upgrade_required");
  });
});
