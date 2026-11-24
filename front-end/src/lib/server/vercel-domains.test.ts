import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  attachVercelDomain,
  getVercelDomainStatus,
  removeVercelDomain,
} from "./vercel-domains";

describe("Vercel domain automation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses manual mode when Vercel credentials are absent", async () => {
    vi.stubEnv("VERCEL_ACCESS_TOKEN", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    await expect(attachVercelDomain("store.example.com")).resolves.toMatchObject({
      configured: false,
      status: "manual",
    });
  });

  it("attaches and reads a verified Vercel domain", async () => {
    vi.stubEnv("VERCEL_ACCESS_TOKEN", "vercel-token");
    vi.stubEnv("VERCEL_PROJECT_ID", "project-1");
    vi.stubEnv("VERCEL_TEAM_ID", "team-1");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ name: "store.example.com", verified: true }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ name: "store.example.com", verified: true }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );

    await expect(attachVercelDomain("store.example.com")).resolves.toMatchObject({
      configured: true,
      attached: true,
      verified: true,
      status: "verified",
    });
    await expect(getVercelDomainStatus("store.example.com")).resolves.toMatchObject({
      attached: true,
      verified: true,
    });
  });

  it("removes an attached Vercel domain", async () => {
    vi.stubEnv("VERCEL_ACCESS_TOKEN", "vercel-token");
    vi.stubEnv("VERCEL_PROJECT_ID", "project-1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(removeVercelDomain("store.example.com")).resolves.toEqual({
      configured: true,
      removed: true,
    });
  });
});
