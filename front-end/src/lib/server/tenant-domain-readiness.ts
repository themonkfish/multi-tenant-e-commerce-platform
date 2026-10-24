import "server-only";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import { resolvePublicAddress } from "@/adapters/data/rest/health-check";

const DNS_TIMEOUT_MS = 3_000;
const HTTPS_TIMEOUT_MS = 5_000;

export type TenantDomainReadiness =
  | { status: "ready"; httpStatus: number; certificateExpiresAt: string | null }
  | {
      status: "http_error";
      httpStatus: number;
      certificateExpiresAt: string | null;
    }
  | { status: "tls_not_ready" }
  | { status: "unreachable" }
  | { status: "blocked_target" }
  | { status: "timeout" };

const certificateErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function isCertificateError(error: NodeJS.ErrnoException): boolean {
  return Boolean(error.code && certificateErrorCodes.has(error.code));
}

export async function checkTenantDomainReadiness(
  domain: string,
): Promise<TenantDomainReadiness> {
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let address: { address: string; family: 4 | 6 } | null;
  try {
    const result = await Promise.race([
      resolvePublicAddress(domain),
      new Promise<"timeout">((resolve) => {
        dnsTimer = setTimeout(() => resolve("timeout"), DNS_TIMEOUT_MS);
      }),
    ]);
    if (result === "timeout") return { status: "timeout" };
    address = result;
  } catch {
    return { status: "unreachable" };
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (!address) return { status: "blocked_target" };

  const url = new URL(`https://${domain}/`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TenantDomainReadiness) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: { Accept: "text/html" },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
        ...(isIP(domain) ? {} : { servername: domain }),
        maxHeaderSize: 8 * 1024,
      },
      (response) => {
        const socket = response.socket as TLSSocket;
        const certificate = socket.getPeerCertificate();
        const expiration = certificate.valid_to
          ? Date.parse(certificate.valid_to)
          : Number.NaN;
        const certificateExpiresAt =
          Number.isFinite(expiration) && expiration > Date.now()
            ? new Date(expiration).toISOString()
            : null;
        response.resume();
        if (!socket.authorized || !certificateExpiresAt) {
          finish({ status: "tls_not_ready" });
          return;
        }
        const httpStatus = response.statusCode ?? 0;
        finish(
          httpStatus >= 200 && httpStatus < 400
            ? { status: "ready", httpStatus, certificateExpiresAt }
            : { status: "http_error", httpStatus, certificateExpiresAt },
        );
      },
    );

    const timer = setTimeout(() => {
      request.destroy();
      finish({ status: "timeout" });
    }, HTTPS_TIMEOUT_MS);
    request.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        status: isCertificateError(error) ? "tls_not_ready" : "unreachable",
      });
    });
    request.end();
  });
}
