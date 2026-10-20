import "server-only";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { TenantRestDataProviderConfig } from "@/core/domain/tenant-config";
import { resolvePublicAddress, validateRestBaseUrl } from "./health-check";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DNS_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type RestHttpRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
};

export type RestHttpResponse = {
  status: number;
  body: unknown;
};

export function buildRequestUrl(
  config: TenantRestDataProviderConfig,
  path: string,
  query?: URLSearchParams,
): URL {
  const baseUrl = validateRestBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error("Invalid REST backend base URL");
  }
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.includes("//")) {
    throw new Error("Invalid REST backend path");
  }
  const url = new URL(`${config.apiVersion}${path}`, `${baseUrl.origin}/`);
  if (query) {
    url.search = query.toString();
  }
  return url;
}

export async function requestSafeRestBackend(
  config: TenantRestDataProviderConfig,
  apiKey: string,
  requestInput: RestHttpRequest,
): Promise<RestHttpResponse> {
  const url = buildRequestUrl(config, requestInput.path, requestInput.query);
  let address: { address: string; family: 4 | 6 } | null;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resolvePublicAddress(url.hostname.replace(/^\[|\]$/g, "")),
      new Promise<"timeout">((resolve) => {
        dnsTimer = setTimeout(() => resolve("timeout"), DNS_TIMEOUT_MS);
      }),
    ]);
    if (result === "timeout") {
      throw new Error("Tenant backend DNS lookup timed out");
    }
    address = result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Tenant backend DNS lookup timed out"
    ) {
      throw error;
    }
    throw new Error("Tenant backend host could not be resolved");
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (!address) {
    throw new Error("Tenant backend resolved to a non-public IP address");
  }

  const body =
    requestInput.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(requestInput.body));

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = 0;
    const timeout: { current?: ReturnType<typeof setTimeout> } = {};
    const finish = (error: Error | null, result?: RestHttpResponse) => {
      if (settled) return;
      settled = true;
      if (timeout.current) clearTimeout(timeout.current);
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Tenant backend returned no response"));
    };
    const request = httpsRequest(
      url,
      {
        method: requestInput.method,
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": body.byteLength,
              }
            : {}),
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
        servername: isIP(url.hostname.replace(/^\[|\]$/g, ""))
          ? undefined
          : url.hostname,
        maxHeaderSize: 16 * 1024,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            request.destroy();
            finish(
              new Error("Tenant backend response exceeded the size limit"),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (response.statusCode === undefined) {
            finish(
              new Error("Tenant backend returned an invalid HTTP response"),
            );
            return;
          }
          const responseText = Buffer.concat(chunks).toString("utf8");
          if (responseText.length === 0) {
            finish(null, { status: response.statusCode, body: null });
            return;
          }
          try {
            finish(null, {
              status: response.statusCode,
              body: JSON.parse(responseText) as unknown,
            });
          } catch {
            finish(new Error("Tenant backend returned invalid JSON"));
          }
        });
      },
    );
    timeout.current = setTimeout(() => {
      request.destroy();
      finish(new Error("Tenant backend request timed out"));
    }, REQUEST_TIMEOUT_MS);
    request.on("error", (error) => {
      finish(new Error(`Tenant backend request failed: ${error.message}`));
    });
    if (body) request.write(body);
    request.end();
  });
}
