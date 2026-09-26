export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Reproducibility fingerprint, not a cryptographic security primitive. */
export function hash(value: unknown): string {
  let h = 0xcbf29ce484222325n;
  for (const c of canonical(value)) {
    h = ((h ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return "fnv1a64:" + h.toString(16).padStart(16, "0");
}
