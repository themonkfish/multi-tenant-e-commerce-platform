import { NextResponse } from "next/server";
import { getPlatformStore } from "@/lib/server/platform";
import {
  createStructuredLogger,
  getRequestCorrelationId,
} from "@/lib/server/observability";

export async function GET(request: Request) {
  const requestId = getRequestCorrelationId(request);
  const logger = createStructuredLogger({ requestId });
  try {
    const store = getPlatformStore();
    const setup = await store.getSetupState();
    logger.info("health.check.completed", {
      status: "healthy",
      platformStore: "configured",
      setupComplete: setup.initialized,
    });
    return NextResponse.json(
      {
        status: "healthy",
        platformStore: "configured",
        setupComplete: setup.initialized,
        timestamp: new Date().toISOString(),
        requestId,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    logger.error("health.check.completed", error, {
      status: "degraded",
      platformStore: "unavailable",
    });
    return NextResponse.json(
      {
        status: "degraded",
        platformStore: "unavailable",
        timestamp: new Date().toISOString(),
        requestId,
      },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
