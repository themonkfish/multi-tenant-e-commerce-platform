import { describe, expect, it } from "vitest";
import {
  getTenantProvisioningReadiness,
  TenantDatabaseConnectionInputSchema,
} from "./tenant-config";

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

  describe("getTenantProvisioningReadiness", () => {
    it("marks the store ready when catalog and at least one payment method are configured", () => {
      const readiness = getTenantProvisioningReadiness({
        restConfigured: false,
        databaseConfigured: true,
        storageConfigured: true,
        stripeConfigured: false,
        stripeEnabled: false,
        cashOnDeliveryEnabled: true,
        staffCount: 2,
        customDomainCount: 1,
      });

      expect(readiness.ready).toBe(true);
      expect(readiness.configuredCount).toBe(5);
      expect(readiness.optionalCount).toBe(3);
    });

    it("reports missing catalog and payment configuration", () => {
      const readiness = getTenantProvisioningReadiness({
        restConfigured: false,
        databaseConfigured: false,
        storageConfigured: false,
        stripeConfigured: false,
        stripeEnabled: true,
        cashOnDeliveryEnabled: false,
        staffCount: 0,
        customDomainCount: 0,
      });

      expect(readiness.ready).toBe(false);
      expect(readiness.items).toEqual([
        { key: "catalog", configured: false },
        { key: "payments", configured: false },
        { key: "storage", configured: false },
        { key: "staff", configured: false },
        { key: "customDomain", configured: false },
      ]);
    });

    it("requires platform Stripe configuration when Stripe is enabled", () => {
      const readiness = getTenantProvisioningReadiness({
        restConfigured: true,
        databaseConfigured: false,
        storageConfigured: false,
        stripeConfigured: false,
        stripeEnabled: true,
        cashOnDeliveryEnabled: false,
        staffCount: 0,
        customDomainCount: 0,
      });

      expect(readiness.ready).toBe(false);
    });
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
