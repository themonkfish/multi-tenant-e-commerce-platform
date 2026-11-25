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
  const wholeUnits = Math.floor(taxableAmount / 10_000);
  const remainder = taxableAmount % 10_000;
  const result =
    wholeUnits * rateBasisPoints +
    Math.floor((remainder * rateBasisPoints + 5_000) / 10_000);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Tax amount or rate is out of range");
  }
  return result;
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
  if (
    !Number.isSafeInteger(tax.rateBasisPoints) ||
    tax.rateBasisPoints < 0 ||
    tax.rateBasisPoints > 10_000
  ) {
    throw new Error("Tax fallback rate is out of range");
  }
  if (!address) return tax.rateBasisPoints;
  const country = address.country.trim().toUpperCase();
  const state = address.state.trim().toLowerCase();
  if (
    !/^[A-Z]{2}$/.test(country) ||
    state.length === 0 ||
    state.length > 100
  ) {
    throw new Error("Tax address jurisdiction is invalid");
  }
  for (const jurisdiction of tax.jurisdictions ?? []) {
    if (
      !/^[A-Z]{2}$/.test(jurisdiction.country.trim().toUpperCase()) ||
      !Number.isSafeInteger(jurisdiction.rateBasisPoints) ||
      jurisdiction.rateBasisPoints < 0 ||
      jurisdiction.rateBasisPoints > 10_000 ||
      (jurisdiction.state !== undefined &&
        (jurisdiction.state.trim().length === 0 ||
          jurisdiction.state.trim().length > 100))
    ) {
      throw new Error("Tax jurisdiction configuration is invalid");
    }
  }
  const exact = tax.jurisdictions?.find(
    (jurisdiction) =>
      jurisdiction.country.trim().toUpperCase() === country &&
      jurisdiction.state !== undefined &&
      jurisdiction.state?.trim().toLowerCase() ===
        state,
  );
  if (exact) return exact.rateBasisPoints;
  const countryOverride = tax.jurisdictions?.find(
    (jurisdiction) =>
      jurisdiction.country.trim().toUpperCase() === country &&
      (!jurisdiction.state || jurisdiction.state.trim().length === 0),
  );
  return countryOverride?.rateBasisPoints ?? tax.rateBasisPoints;
}
