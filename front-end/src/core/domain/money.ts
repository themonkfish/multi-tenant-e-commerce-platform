export function formatCurrencyAmount(
  amount: number,
  currency: string,
  locale: string,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const minorUnitFactor =
    10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
  return formatter.format(amount / minorUnitFactor);
}
