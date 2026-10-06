export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Impuesto en centavos, redondeado al centavo (bps: 875 = 8.75%). */
export function taxOf(subtotalCents: number, taxRateBps: number): number {
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}

/** Código corto que se puede decir por teléfono ("A-482"). Sin letras confundibles. */
export function shortCode(prefix: string): string {
  return `${prefix}-${100 + Math.floor(Math.random() * 900)}`;
}
