import "server-only";
import { getServerEnv } from "./env";
import { recordObservabilityMetric } from "./observability";

const LIMIT_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "if count > tonumber(ARGV[2]) then return 0 end",
  "return 1",
].join("\n");

export type DistributedRateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
};

export async function consumeDistributedRateLimit(
  input: DistributedRateLimitInput,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const env = getServerEnv();
  const url =
    env.DISTRIBUTED_RATE_LIMIT_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token =
    env.DISTRIBUTED_RATE_LIMIT_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1_000_000 ||
    !Number.isSafeInteger(input.windowMs) ||
    input.windowMs < 1 ||
    input.windowMs > 86_400_000
  ) {
    throw new Error("Distributed rate-limit parameters are out of range");
  }

  const key = `${env.DISTRIBUTED_RATE_LIMIT_PREFIX}:rate:${input.key}`;
  const endpoint = `${url.replace(/\/$/, "")}/eval`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        script: LIMIT_SCRIPT,
        keys: [key],
        args: [String(input.windowMs), String(input.limit)],
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error(
        `Distributed rate-limit provider returned HTTP ${response.status}`,
      );
    }
    const body = (await response.json().catch(() => null)) as
      | number
      | { result?: number }
      | null;
    const allowed =
      typeof body === "number"
        ? body === 1
        : typeof body?.result === "number"
          ? body.result === 1
          : null;
    if (allowed === null) {
      throw new Error("Distributed rate-limit provider returned an invalid result");
    }
    recordObservabilityMetric(
      allowed
        ? "rate_limit.distributed.allowed"
        : "rate_limit.distributed.rejected",
    );
    return allowed;
  } catch (error) {
    recordObservabilityMetric("rate_limit.distributed.error");
    const failMode =
      env.DISTRIBUTED_RATE_LIMIT_FAIL_MODE ??
      (env.NODE_ENV === "production" ? "closed" : "open");
    if (failMode === "closed") {
      recordObservabilityMetric("rate_limit.distributed.rejected");
      return false;
    }
    console.error("Distributed rate-limit unavailable; failing open", error);
    return true;
  }
}
