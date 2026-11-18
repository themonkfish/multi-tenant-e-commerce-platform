import { NextResponse } from "next/server";
import { getPlatformStore } from "@/lib/server/platform";

export async function GET() {
  try {
    const store = getPlatformStore();
    const setup = await store.getSetupState();
    return NextResponse.json({
      status: "healthy",
      platformStore: "configured",
      setupComplete: setup.initialized,
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        platformStore: "unavailable",
      },
      { status: 503 },
    );
  }
}
