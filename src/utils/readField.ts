// Tolerant field reads over a public read model (a JSON object of unknown
// shape): the value when it is the expected type, otherwise undefined.

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
