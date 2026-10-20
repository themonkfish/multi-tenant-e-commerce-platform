import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import {
  type TenantRestDataProviderConfig,
  type RestHealthCheckResult,
} from "@/core/domain/tenant-config";

const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const DNS_TIMEOUT_MS = 3_000;

function ipv4ToNumber(address: string): number {
  return address
    .split(".")
    .reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function inIpv4Range(
  address: string,
  network: string,
  prefix: number,
): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}

function ipv6Bytes(address: string): number[] | null {
  const normalized = address.toLowerCase().split("%")[0];
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => {
    if (!half) return [];
    const parts = half.split(":");
    const bytes: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        if (isIP(part) !== 4) return null;
        const octets = part.split(".").map(Number);
        bytes.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        bytes.push(Number.parseInt(part, 16));
      } else {
        return null;
      }
    }
    return bytes;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  const words =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  if (words.length !== 8) return null;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const blockedRanges: [string, number][] = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !blockedRanges.some(([network, prefix]) =>
      inIpv4Range(address, network, prefix),
    );
  }
  if (family !== 6) return false;
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const isGlobalUnicast = bytes[0] >= 0x20 && bytes[0] <= 0x3f;
  const isDocumentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8;
  const isSpecial2001 =
    bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] <= 0x01;
  const is6to4 = bytes[0] === 0x20 && bytes[1] === 0x02;
  const isDocumentation3fff =
    bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0;
  return (
    isGlobalUnicast &&
    !isDocumentation &&
    !isSpecial2001 &&
    !is6to4 &&
    !isDocumentation3fff
  );
}

export function validateRestBaseUrl(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== "443") ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function buildHealthCheckUrl(config: TenantRestDataProviderConfig): URL {
  const baseUrl = validateRestBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error("Invalid REST backend base URL");
  }
  return new URL(`${config.apiVersion}/health`, `${baseUrl.origin}/`);
}

async function resolvePublicAddress(
  hostname: string,
): Promise<{ address: string; family: 4 | 6 } | null> {
  if (isIP(hostname)) {
    const family = isIP(hostname);
    return isPublicIpAddress(hostname)
      ? { address: hostname, family: family as 4 | 6 }
      : null;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    return null;
  }
  const selected = addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export async function checkRestBackendHealth(
  config: TenantRestDataProviderConfig,
  apiKey: string,
): Promise<RestHealthCheckResult> {
  const startedAt = Date.now();
  const url = buildHealthCheckUrl(config);
  let pinnedAddress: { address: string; family: 4 | 6 } | null;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resolution = await Promise.race([
      resolvePublicAddress(url.hostname.replace(/^\[|\]$/g, "")),
      new Promise<"timeout">((resolve) => {
        dnsTimer = setTimeout(() => resolve("timeout"), DNS_TIMEOUT_MS);
      }),
    ]);
    if (resolution === "timeout") {
      return {
        status: "unhealthy",
        latencyMs: Date.now() - startedAt,
        missing: [],
        error: "timeout",
      };
    }
    pinnedAddress = resolution;
  } catch {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - startedAt,
      missing: [],
      error: "unreachable",
    };
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (!pinnedAddress) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - startedAt,
      missing: [],
      error: "blocked_target",
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout: { current?: ReturnType<typeof setTimeout> } = {};
    let responseBytes = 0;
    const finish = (result: Omit<RestHealthCheckResult, "latencyMs">) => {
      if (settled) return;
      settled = true;
      if (timeout.current) clearTimeout(timeout.current);
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
        servername: isIP(url.hostname.replace(/^\[|\]$/g, ""))
          ? undefined
          : url.hostname,
        maxHeaderSize: 8 * 1024,
      },
      (response) => {
        if (
          response.statusCode === undefined ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          response.resume();
          finish({
            status: "unhealthy",
            missing: [],
            error: "invalid_response",
          });
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            request.destroy();
            finish({
              status: "unhealthy",
              missing: [],
              error: "invalid_response",
            });
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          let payload: unknown;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            finish({
              status: "unhealthy",
              missing: ["status", "db", "storage"],
              error: "invalid_response",
            });
            return;
          }
          if (typeof payload !== "object" || payload === null) {
            finish({
              status: "unhealthy",
              missing: ["status", "db", "storage"],
              error: "invalid_response",
            });
            return;
          }
          const body = payload as Record<string, unknown>;
          const missing = ["status", "db", "storage"].filter((key) => {
            const value = body[key];
            if (key === "db" || key === "storage") {
              return value !== "up" && value !== "down";
            }
            return typeof value !== "string" || value.length === 0;
          });
          const down = ["db", "storage"].filter((key) => body[key] === "down");
          finish({
            status:
              missing.length === 0 && down.length === 0
                ? "healthy"
                : "unhealthy",
            missing: [...missing, ...down],
            ...(typeof body.schemaVersion === "string"
              ? { schemaVersion: body.schemaVersion.slice(0, 64) }
              : {}),
            ...(missing.length > 0 ? { error: "invalid_response" } : {}),
          });
        });
      },
    );
    timeout.current = setTimeout(() => {
      request.destroy();
      finish({ status: "unhealthy", missing: [], error: "timeout" });
    }, REQUEST_TIMEOUT_MS);
    request.on("error", () => {
      finish({ status: "unhealthy", missing: [], error: "unreachable" });
    });
    request.end();
  });
}
