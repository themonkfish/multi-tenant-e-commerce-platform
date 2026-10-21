import { describe, expect, it } from "vitest";
import {
  canAccessPermission,
  canAccessScope,
  hasPermission,
  ROLE_PERMISSIONS,
  type Principal,
} from "./scope";

describe("canAccessScope", () => {
  it("lets a host access its own host and tenants", () => {
    const host = { kind: "host", id: "host-a" } as const;

    expect(canAccessScope(host, { kind: "host", id: "host-a" })).toBe(true);
    expect(
      canAccessScope(host, {
        kind: "tenant",
        id: "tenant-a",
        hostId: "host-a",
      }),
    ).toBe(true);
  });

  it("prevents access across host and tenant boundaries", () => {
    const host = { kind: "host", id: "host-a" } as const;
    const tenant = {
      kind: "tenant",
      id: "tenant-a",
      hostId: "host-a",
    } as const;

    expect(canAccessScope(host, { kind: "host", id: "host-b" })).toBe(false);
    expect(
      canAccessScope(host, {
        kind: "tenant",
        id: "tenant-b",
        hostId: "host-b",
      }),
    ).toBe(false);
    expect(
      canAccessScope(tenant, {
        kind: "tenant",
        id: "tenant-b",
        hostId: "host-a",
      }),
    ).toBe(false);
    expect(
      canAccessScope(tenant, {
        kind: "tenant",
        id: "tenant-a",
        hostId: "host-b",
      }),
    ).toBe(false);
  });

  it("allows platform scope and checks permissions explicitly", () => {
    expect(
      canAccessScope(
        { kind: "platform", id: "platform" },
        { kind: "tenant", id: "tenant-a", hostId: "host-a" },
      ),
    ).toBe(true);

    expect(
      hasPermission(
        {
          userId: "user-a",
          role: "host_owner",
          scope: { kind: "host", id: "host-a" },
          permissions: ["tenant:read"],
        },
        "tenant:read",
      ),
    ).toBe(true);
  });

  it("assigns only the permissions defined for each implemented owner role", () => {
    expect(ROLE_PERMISSIONS.super_admin).toEqual([
      "platform:read",
      "platform:write",
    ]);
    expect(ROLE_PERMISSIONS.host_owner).toEqual([
      "tenant:read",
      "tenant:write",
    ]);
    expect(ROLE_PERMISSIONS.tenant_owner).toContain("settings:write");
  });

  it("requires both the requested permission and an accessible scope", () => {
    const hostOwner: Principal = {
      userId: "user-a",
      role: "host_owner",
      scope: { kind: "host", id: "host-a" },
      permissions: [...ROLE_PERMISSIONS.host_owner],
    };

    expect(
      canAccessPermission(hostOwner, "tenant:write", {
        kind: "tenant",
        id: "tenant-a",
        hostId: "host-a",
      }),
    ).toBe(true);
    expect(
      canAccessPermission(hostOwner, "settings:write", {
        kind: "tenant",
        id: "tenant-a",
        hostId: "host-a",
      }),
    ).toBe(false);
    expect(
      canAccessPermission(hostOwner, "tenant:write", {
        kind: "tenant",
        id: "tenant-b",
        hostId: "host-b",
      }),
    ).toBe(false);
    expect(
      canAccessPermission(
        {
          ...hostOwner,
          permissions: ["tenant:read", "platform:write"],
        },
        "platform:write",
      ),
    ).toBe(false);
  });

  it("limits Staff to assigned catalog permissions", () => {
    const staff: Principal = {
      userId: "staff-a",
      role: "tenant_staff",
      scope: { kind: "tenant", id: "tenant-a", hostId: "host-a" },
      permissions: ["catalog:read", "catalog:write"],
    };

    expect(canAccessPermission(staff, "catalog:read")).toBe(true);
    expect(canAccessPermission(staff, "catalog:write")).toBe(true);
    expect(canAccessPermission(staff, "settings:write")).toBe(false);
    expect(canAccessPermission(staff, "tenant:write")).toBe(false);
    expect(canAccessPermission(staff, "staff:manage")).toBe(false);
    expect(
      canAccessPermission(staff, "catalog:read", {
        kind: "tenant",
        id: "tenant-b",
        hostId: "host-a",
      }),
    ).toBe(false);
  });

  it("limits Customers to tenant-scoped order reads", () => {
    const customer: Principal = {
      userId: "customer-a",
      role: "customer",
      scope: { kind: "tenant", id: "tenant-a", hostId: "host-a" },
      permissions: ["customer:orders:read"],
    };

    expect(canAccessPermission(customer, "customer:orders:read")).toBe(true);
    expect(canAccessPermission(customer, "catalog:read")).toBe(false);
    expect(canAccessPermission(customer, "settings:read")).toBe(false);
    expect(
      canAccessPermission(customer, "customer:orders:read", {
        kind: "tenant",
        id: "tenant-b",
        hostId: "host-a",
      }),
    ).toBe(false);
  });
});
