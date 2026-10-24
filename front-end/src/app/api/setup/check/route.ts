import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlatformStore } from "@/adapters/platform/factory";
import type { PlatformSetupState } from "@/core/ports/platform-store";
import { encryptSecret, timingSafeStringEqual } from "@/lib/server/crypto";
import { isSameOrigin } from "@/lib/server/http";
import { getServerEnv } from "@/lib/server/env";

const CheckSchema = z.object({ setupToken: z.string().min(32) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CheckSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const setupToken = z.string().min(32).safeParse(process.env.SETUP_TOKEN);
  if (!setupToken.success) {
    return NextResponse.json(
      { error: "setup_token_not_configured" },
      { status: 503 },
    );
  }
  if (!timingSafeStringEqual(parsed.data.setupToken, setupToken.data)) {
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

  let env;
  try {
    env = getServerEnv();
    encryptSecret("setup-preflight");
  } catch {
    return NextResponse.json(
      { error: "server_configuration_invalid" },
      { status: 503 },
    );
  }

  let state: PlatformSetupState;
  try {
    state = await createPlatformStore().getSetupState();
  } catch {
    return NextResponse.json(
      { error: "platform_store_unavailable" },
      { status: 503 },
    );
  }
  if (state.initialized) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    platformStore: env.PLATFORM_STORE,
    connection: "ready",
    securityConfiguration: "ready",
    invitations: "manual",
  });
}
