import { describe, expect, it } from "vitest";
import {
  getTenantProvisioningReadiness,
  TenantDatabaseConnectionInputSchema,
  TenantStorageConnectionInputSchema,
  TenantStorageProviderConfigSchema,
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

  describe("TenantStorageConnectionInputSchema", () => {
    it("accepts S3 and Supabase Storage provider configurations", () => {
      expect(
        TenantStorageConnectionInputSchema.safeParse({
          type: "s3",
          region: "ap-south-1",
          bucket: "tenant-assets",
          publicBaseUrl: "https://cdn.example.com",
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        }).success,
      ).toBe(true);
      expect(
        TenantStorageConnectionInputSchema.safeParse({
          type: "supabase",
          projectUrl: "https://tenant-project.supabase.co",
          bucket: "tenant-assets",
          serviceKey: "tenant-service-key",
        }).success,
      ).toBe(true);
    });

    it("rejects partial S3 credentials and unsafe Supabase project URLs", () => {
      expect(
        TenantStorageConnectionInputSchema.safeParse({
          type: "s3",
          region: "ap-south-1",
          bucket: "tenant-assets",
          publicBaseUrl: "https://cdn.example.com",
          accessKeyId: "access-key",
        }).success,
      ).toBe(false);
      expect(
        TenantStorageConnectionInputSchema.safeParse({
          type: "supabase",
          projectUrl: "http://tenant-project.supabase.co",
          bucket: "tenant-assets",
          serviceKey: "tenant-service-key",
        }).success,
      ).toBe(false);
    });

    it("parses Supabase and S3 provider configs", () => {
      expect(
        TenantStorageProviderConfigSchema.safeParse({
          type: "supabase",
          projectUrl: "https://tenant-project.supabase.co",
          bucket: "tenant-assets",
          credentialsRef: "secret-ref",
        }).success,
      ).toBe(true);
    });
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
