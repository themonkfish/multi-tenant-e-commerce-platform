import "server-only";
import {
  resolveCname,
  resolveTxt,
  resolve4,
  resolve6,
} from "node:dns/promises";

type DnsResolver = {
  resolveCname(domain: string): Promise<string[]>;
  resolveTxt(domain: string): Promise<string[][]>;
  resolveA?(domain: string): Promise<string[]>;
  resolveAAAA?(domain: string): Promise<string[]>;
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
  resolver: DnsResolver = {
    resolveCname,
    resolveTxt,
    resolveA: resolve4,
    resolveAAAA: resolve6,
  },
): Promise<boolean> {
  const txtRecords = await resolver
    .resolveTxt(`_platform-verification.${domain}`)
    .catch((error: unknown) => {
      if (isMissingRecord(error)) return [];
      throw error;
    });
  const target = platformDomain.toLowerCase().replace(/\.$/, "");
  const expectedTxt = `platform-verification=${verificationToken}`;
  const hasChallenge = txtRecords.some(
    (record) => record.join("") === expectedTxt,
  );
  if (!hasChallenge) return false;

  if (isApexDomainName(domain)) {
    if (!resolver.resolveA || !resolver.resolveAAAA) return false;
    const [domainAddresses, platformAddresses] = await Promise.all([
      resolveAddressSet(resolver, domain),
      resolveAddressSet(resolver, target),
    ]);
    return (
      domainAddresses.length > 0 &&
      platformAddresses.some((address) => domainAddresses.includes(address))
    );
  }

  const cnameRecords = await resolver.resolveCname(domain).catch((error: unknown) => {
    if (isMissingRecord(error)) return [];
    throw error;
  });
  const hasTarget = cnameRecords.some(
    (record) => record.toLowerCase().replace(/\.$/, "") === target,
  );
  return hasTarget;
}

async function resolveAddressSet(
  resolver: DnsResolver,
  domain: string,
): Promise<string[]> {
  const [addressesA, addressesAAAA] = await Promise.all([
    resolver.resolveA?.(domain).catch((error: unknown) => {
      if (isMissingRecord(error)) return [];
      throw error;
    }) ?? Promise.resolve([]),
    resolver.resolveAAAA?.(domain).catch((error: unknown) => {
      if (isMissingRecord(error)) return [];
      throw error;
    }) ?? Promise.resolve([]),
  ]);
  return [...new Set([...addressesA, ...addressesAAAA])];
}

function isApexDomainName(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length === 2) return true;
  return (
    labels.length === 3 &&
    new Set(["ac", "co", "com", "edu", "gov", "net", "org"]).has(
      labels.at(-2) ?? "",
    )
  );
}
