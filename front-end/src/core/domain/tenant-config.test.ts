import { describe, expect, it } from "vitest";
import { TenantDatabaseConnectionInputSchema } from "./tenant-config";

describe("TenantDatabaseConnectionInputSchema", () => {
  it("accepts dedicated Supabase and MongoDB Atlas providers", () => {
    expect(
      TenantDatabaseConnectionInputSchema.safeParse({
        type: "supabase",
        projectUrl: "https://tenant-project.supabase.co",
        serviceKey: "tenant-service-key",
      }).success,
    ).toBe(true);
    expect(
      TenantDatabaseConnectionInputSchema.safeParse({
        type: "mongodb",
        dbName: "tenant_catalog",
        connectionString:
          "mongodb+srv://catalog-user:password@cluster.ab12.mongodb.net/",
      }).success,
    ).toBe(true);
  });

  it.each([
    "http://tenant-project.supabase.co",
    "https://localhost",
    "https://tenant-project.supabase.co/path",
    "https://user:password@tenant-project.supabase.co",
  ])("rejects unsupported Supabase project URL %s", (projectUrl) => {
    expect(
      TenantDatabaseConnectionInputSchema.safeParse({
        type: "supabase",
        projectUrl,
        serviceKey: "tenant-service-key",
      }).success,
    ).toBe(false);
  });

  it("does not accept shared-tenancy mode for direct database credentials", () => {
    expect(
      TenantDatabaseConnectionInputSchema.safeParse({
        type: "supabase",
        projectUrl: "https://tenant-project.supabase.co",
        serviceKey: "tenant-service-key",
        tenancyMode: "shared-rls",
      }).success,
    ).toBe(false);
  });
});
