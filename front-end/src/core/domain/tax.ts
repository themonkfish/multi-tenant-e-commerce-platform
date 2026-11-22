export function calculateTaxAmount(
  taxableAmount: number,
  rateBasisPoints: number,
): number {
  if (
    !Number.isSafeInteger(taxableAmount) ||
    taxableAmount < 0 ||
    !Number.isSafeInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > 10_000
  ) {
    throw new Error("Tax amount or rate is out of range");
  }
  return Math.round((taxableAmount * rateBasisPoints) / 10_000);
}

export type TenantTaxJurisdiction = {
  country: string;
  state?: string;
  rateBasisPoints: number;
};

export function resolveTenantTaxRate(
  tax: {
    rateBasisPoints: number;
    jurisdictions?: TenantTaxJurisdiction[];
  },
  address: { country: string; state: string } | undefined,
): number {
  if (!address) return tax.rateBasisPoints;
  const exact = tax.jurisdictions?.find(
    (jurisdiction) =>
      jurisdiction.country === address.country &&
      jurisdiction.state?.trim().toLowerCase() ===
        address.state.trim().toLowerCase(),
  );
  if (exact) return exact.rateBasisPoints;
  const country = tax.jurisdictions?.find(
    (jurisdiction) =>
      jurisdiction.country === address.country &&
      jurisdiction.state === undefined,
  );
  return country?.rateBasisPoints ?? tax.rateBasisPoints;
}
