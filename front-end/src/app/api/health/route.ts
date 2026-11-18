import { NextResponse } from "next/server";
import { getPlatformStore } from "@/lib/server/platform";
import { getRequestCorrelationId } from "@/lib/server/observability";

export async function GET(request: Request) {
  const requestId = getRequestCorrelationId(request);
  try {
    const store = getPlatformStore();
    const setup = await store.getSetupState();
    return NextResponse.json(
      {
        status: "healthy",
        platformStore: "configured",
        setupComplete: setup.initialized,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        platformStore: "unavailable",
      },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
