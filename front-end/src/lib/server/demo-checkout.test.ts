import { afterEach, describe, expect, it, vi } from "vitest";

const { getServerEnv } = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/server/env", () => ({ getServerEnv }));

import {
  createDemoCheckoutSessionId,
  isDemoCheckoutSession,
  isLocalDemoCheckoutEnabled,
} from "./demo-checkout";

describe("local demo checkout guard", () => {
  afterEach(() => vi.clearAllMocks());

  it("enables demo checkout only for the isolated local development store", () => {
    getServerEnv.mockReturnValue({
      NODE_ENV: "development",
      PLATFORM_STORE: "file",
      PLATFORM_STORE_FILE: ".local/demo-platform-store.json",
      DEMO_CHECKOUT_ENABLED: true,
    });

    expect(isLocalDemoCheckoutEnabled("store.localhost:3000")).toBe(true);
    expect(isLocalDemoCheckoutEnabled("127.0.0.1:3000")).toBe(true);
    expect(isLocalDemoCheckoutEnabled("store.example.com")).toBe(false);
  });

  it.each([
    {
      name: "production",
      env: {
        NODE_ENV: "production",
        PLATFORM_STORE: "file",
        PLATFORM_STORE_FILE: ".local/demo-platform-store.json",
        DEMO_CHECKOUT_ENABLED: true,
      },
    },
    {
      name: "Supabase",
      env: {
        NODE_ENV: "development",
        PLATFORM_STORE: "supabase",
        PLATFORM_STORE_FILE: ".local/demo-platform-store.json",
        DEMO_CHECKOUT_ENABLED: true,
      },
    },
    {
      name: "disabled demo mode",
      env: {
        NODE_ENV: "development",
        PLATFORM_STORE: "file",
        PLATFORM_STORE_FILE: ".local/demo-platform-store.json",
        DEMO_CHECKOUT_ENABLED: false,
      },
    },
    {
      name: "non-demo file store",
      env: {
        NODE_ENV: "development",
        PLATFORM_STORE: "file",
        PLATFORM_STORE_FILE: ".local/platform-store.json",
        DEMO_CHECKOUT_ENABLED: true,
      },
    },
  ])("blocks $name", ({ env }) => {
    getServerEnv.mockReturnValue(env);
    expect(isLocalDemoCheckoutEnabled("store.localhost:3000")).toBe(false);
  });

  it("identifies demo sessions and generates unique attempt IDs", () => {
    const first = createDemoCheckoutSessionId(1);
    const second = createDemoCheckoutSessionId(1);

    expect(first).toMatch(/^demo_1_/);
    expect(second).not.toBe(first);
    expect(isDemoCheckoutSession(first)).toBe(true);
    expect(isDemoCheckoutSession("cs_test_example")).toBe(false);
  });
});
