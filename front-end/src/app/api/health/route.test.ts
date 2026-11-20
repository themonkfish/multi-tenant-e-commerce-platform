import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const getPlatformStore = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/platform", () => ({ getPlatformStore }));

describe("GET /api/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns healthy setup state", async () => {
    getPlatformStore.mockReturnValue({
      getSetupState: vi.fn().mockResolvedValue({ initialized: true }),
    });
    const response = await GET(
      new Request("https://platform.example.com/api/health", {
        headers: { "x-request-id": "health-request-1" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("health-request-1");
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      platformStore: "configured",
      setupComplete: true,
      timestamp: expect.any(String),
      requestId: "health-request-1",
      observability: expect.objectContaining({
        uptimeSeconds: expect.any(Number),
        counters: expect.any(Object),
      }),
    });
  });

  it("returns degraded state when the platform store fails", async () => {
    getPlatformStore.mockImplementation(() => {
      throw new Error("store unavailable");
    });
    const response = await GET(
      new Request("https://platform.example.com/api/health"),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      platformStore: "unavailable",
    });
  });
});
