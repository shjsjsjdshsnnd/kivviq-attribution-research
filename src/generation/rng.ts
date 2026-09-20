function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableStringify(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class SeededRandom {
  private state: number;
  private spareNormal: number | undefined;

  public constructor(seedMaterial: string | number) {
    const seed =
      typeof seedMaterial === "number"
        ? seedMaterial >>> 0
        : fnv1a32(seedMaterial);
    this.state = seed === 0 ? 0x6d2b79f5 : seed;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    this.state >>>= 0;
    return result;
  }

  public bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  public uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  public integer(min: number, maxInclusive: number): number {
    return Math.floor(this.uniform(min, maxInclusive + 1));
  }

  public normal(mean = 0, standardDeviation = 1): number {
    if (this.spareNormal !== undefined) {
      const spare = this.spareNormal;
      this.spareNormal = undefined;
      return mean + standardDeviation * spare;
    }

    const u1 = Math.max(Number.EPSILON, this.next());
    const u2 = Math.max(Number.EPSILON, this.next());
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    const z0 = magnitude * Math.cos(2 * Math.PI * u2);
    const z1 = magnitude * Math.sin(2 * Math.PI * u2);
    this.spareNormal = z1;
    return mean + standardDeviation * z0;
  }

  public logNormal(logMean: number, logStandardDeviation: number): number {
    return Math.exp(this.normal(logMean, logStandardDeviation));
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new RangeError("cannot pick from an empty collection");
    }
    return values[this.integer(0, values.length - 1)]!;
  }

  public weightedPick<T>(
    values: readonly { readonly value: T; readonly weight: number }[],
  ): T {
    const positive = values.filter((entry) => entry.weight > 0);
    if (positive.length === 0) {
      throw new RangeError("weightedPick requires at least one positive weight");
    }
    const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = this.uniform(0, total);
    for (const entry of positive) {
      cursor -= entry.weight;
      if (cursor <= 0) return entry.value;
    }
    return positive[positive.length - 1]!.value;
  }

  public jitter(value: number, relativeStdDev: number): number {
    return value * Math.exp(this.normal(0, relativeStdDev));
  }

  public fork(label: string): SeededRandom {
    return new SeededRandom(`${this.state}:${label}`);
  }
}

export function configSeed(
  seed: number,
  generatorVersion: string,
  config: unknown,
): string {
  return `${generatorVersion}|${seed}|${stableStringify(config)}`;
}
