/** All amounts are integer centavos. Never use floating-point values for ledger arithmetic. */
export type Centavos = bigint;

export function parsePhpToCentavos(input: string): Centavos {
  const normalized = input.trim().replace(/,/g, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid non-negative PHP amount with at most two decimal places.");
  }
  const normalized = raw.replace(/,/g, "");
  const [pesos, fraction = ""] = normalized.split(".");
  return BigInt(pesos) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function formatPhp(centavos: Centavos | number): string {
  const value = typeof centavos === "bigint" ? centavos : BigInt(centavos);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const pesos = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₱${pesos.toLocaleString("en-PH")}.${cents}`;
}
