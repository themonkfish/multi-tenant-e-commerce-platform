import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeDistributedRateLimit } from "./distributed-rate-limit";

describe("consumeDistributedRateLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when distributed limiter configuration is absent", async () => {
    await expect(
      consumeDistributedRateLimit({
        key: "test-key",
        limit: 10,
        windowMs: 60_000,
        now: Date.now(),
      }),
    ).resolves.toBeNull();
  });

  it("allows an atomic provider result below the limit", async () => {
    vi.stubEnv(
      "DISTRIBUTED_RATE_LIMIT_URL",
      "https://rate-limit.example.com",
    );
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_TOKEN", "test-token");
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_PREFIX", "platform-test");
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_FAIL_MODE", "closed");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      consumeDistributedRateLimit(
        {
          key: "hashed-action",
          limit: 10,
          windowMs: 60_000,
          now: Date.now(),
        },
        fetchMock,
      ),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://rate-limit.example.com/eval",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("rejects an atomic provider result at or above the limit", async () => {
    vi.stubEnv(
      "DISTRIBUTED_RATE_LIMIT_URL",
      "https://rate-limit.example.com",
    );
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_TOKEN", "test-token");
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_FAIL_MODE", "closed");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      consumeDistributedRateLimit(
        {
          key: "hashed-action",
          limit: 10,
          windowMs: 60_000,
          now: Date.now(),
        },
        fetchMock,
      ),
    ).resolves.toBe(false);
  });

  it("fails open in development when the provider is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DISTRIBUTED_RATE_LIMIT_URL",
      "https://rate-limit.example.com",
    );
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_TOKEN", "test-token");
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_FAIL_MODE", "open");

    await expect(
      consumeDistributedRateLimit(
        {
          key: "hashed-action",
          limit: 10,
          windowMs: 60_000,
          now: Date.now(),
        },
        vi.fn().mockRejectedValue(new Error("provider unavailable")),
      ),
    ).resolves.toBe(true);
  });

  it("fails closed in production when the provider is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_STORE", "supabase");
    vi.stubEnv("PLATFORM_SUPABASE_URL", "https://platform.supabase.co");
    vi.stubEnv("PLATFORM_SUPABASE_SERVICE_KEY", "test-service-key");
    vi.stubEnv("PLATFORM_SECRET_KEY", "11".repeat(32));
    vi.stubEnv("SESSION_SECRET", "production-session-secret-at-least-32");
    vi.stubEnv(
      "DISTRIBUTED_RATE_LIMIT_URL",
      "https://rate-limit.example.com",
    );
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_TOKEN", "test-token");
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_FAIL_MODE", "closed");

    await expect(
      consumeDistributedRateLimit(
        {
          key: "hashed-action",
          limit: 10,
          windowMs: 60_000,
          now: Date.now(),
        },
        vi.fn().mockRejectedValue(new Error("provider unavailable")),
      ),
    ).resolves.toBe(false);
  });

  it("rejects invalid limiter parameters", async () => {
    vi.stubEnv(
      "DISTRIBUTED_RATE_LIMIT_URL",
      "https://rate-limit.example.com",
    );
    vi.stubEnv("DISTRIBUTED_RATE_LIMIT_TOKEN", "test-token");

    await expect(
      consumeDistributedRateLimit({
        key: "hashed-action",
        limit: 0,
        windowMs: 60_000,
        now: Date.now(),
      }),
    ).rejects.toThrow("out of range");
  });
});
