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
