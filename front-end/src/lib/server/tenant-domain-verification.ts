import "server-only";
import { resolveCname, resolveTxt } from "node:dns/promises";

type DnsResolver = {
  resolveCname(domain: string): Promise<string[]>;
  resolveTxt(domain: string): Promise<string[][]>;
};

const missingRecordCodes = new Set(["ENODATA", "ENOTFOUND", "ENONAME"]);

function isMissingRecord(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    missingRecordCodes.has(error.code)
  );
}

export async function verifyTenantDomainDns(
  domain: string,
  platformDomain: string,
  verificationToken: string,
  resolver: DnsResolver = { resolveCname, resolveTxt },
): Promise<boolean> {
  const [cnameRecords, txtRecords] = await Promise.all([
    resolver.resolveCname(domain).catch((error: unknown) => {
      if (isMissingRecord(error)) return [];
      throw error;
    }),
    resolver
      .resolveTxt(`_platform-verification.${domain}`)
      .catch((error: unknown) => {
        if (isMissingRecord(error)) return [];
        throw error;
      }),
  ]);
  const target = platformDomain.toLowerCase().replace(/\.$/, "");
  const hasTarget = cnameRecords.some(
    (record) => record.toLowerCase().replace(/\.$/, "") === target,
  );
  const expectedTxt = `platform-verification=${verificationToken}`;
  const hasChallenge = txtRecords.some(
    (record) => record.join("") === expectedTxt,
  );

  return hasTarget && hasChallenge;
}
