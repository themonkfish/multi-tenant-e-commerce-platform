import { describe, expect, it } from "vitest";
import { createRateLimitKey, isSameOrigin } from "./http";

describe("isSameOrigin", () => {
  it("matches the browser origin against the forwarded request host", () => {
    const request = new Request("http://localhost:3000/api/action", {
      headers: {
        host: "store.localhost:3000",
        origin: "http://store.localhost:3000",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("uses the original HTTPS protocol behind a reverse proxy", () => {
    const request = new Request("http://internal-app/api/action", {
      headers: {
        host: "store.example.com",
        origin: "https://store.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("rejects cross-origin or missing-origin requests", () => {
    const crossOrigin = new Request("http://localhost:3000/api/action", {
      headers: {
        host: "store.localhost:3000",
        origin: "http://attacker.example",
      },
    });
    const missingOrigin = new Request("http://localhost:3000/api/action", {
      headers: { host: "store.localhost:3000" },
    });

    expect(isSameOrigin(crossOrigin)).toBe(false);
    expect(isSameOrigin(missingOrigin)).toBe(false);
  });
});

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
