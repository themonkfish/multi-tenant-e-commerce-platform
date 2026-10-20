import { describe, expect, it } from "vitest";
import { createRateLimitKey } from "./http";

describe("createRateLimitKey", () => {
  it("separates authenticated mutation buckets by account", () => {
    const request = new Request("http://localhost:3000/api/host/tenants", {
      headers: { "x-forwarded-for": "192.0.2.10" },
    });

    expect(createRateLimitKey(request, "tenant-create", "owner-a")).toBe(
      createRateLimitKey(request, "tenant-create", "owner-a"),
    );
    expect(createRateLimitKey(request, "tenant-create", "owner-a")).not.toBe(
      createRateLimitKey(request, "tenant-create", "owner-b"),
    );
    expect(createRateLimitKey(request, "tenant-create", "owner-a")).not.toBe(
      createRateLimitKey(request, "tenant-update", "owner-a"),
    );
  });

  it("keeps unauthenticated rate limits scoped to the client address", () => {
    const firstClient = new Request("http://localhost:3000/api/login", {
      headers: { "x-real-ip": "192.0.2.10" },
    });
    const secondClient = new Request("http://localhost:3000/api/login", {
      headers: { "x-real-ip": "192.0.2.11" },
    });

    expect(createRateLimitKey(firstClient, "login")).not.toBe(
      createRateLimitKey(secondClient, "login"),
    );
  });
});
