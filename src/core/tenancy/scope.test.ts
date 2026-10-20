import { describe, expect, it } from "vitest";
import { canAccessScope, hasPermission } from "./scope";

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
          scope: { kind: "host", id: "host-a" },
          permissions: ["tenant:read"],
        },
        "tenant:read",
      ),
    ).toBe(true);
  });
});
