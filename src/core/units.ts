declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type Probability = Brand<number, "Probability">;
export type MoneyMinor = Brand<number, "MoneyMinor">;
export type NonNegativeNumber = Brand<number, "NonNegativeNumber">;
export type PositiveNumber = Brand<number, "PositiveNumber">;
export type DurationSeconds = Brand<number, "DurationSeconds">;
export type UtcTimestamp = Brand<string, "UtcTimestamp">;
export type CurrencyCode = Brand<string, "CurrencyCode">;

export type EffectScale =
  | "absolute"
  | "relative"
  | "multiplicative"
  | "log"
  | "probability_point"
  | "money_minor"
  | "units";

export type CausalUnit =
  | "probability"
  | "money_minor"
  | "units"
  | "orders"
  | "customers"
  | "impressions"
  | "clicks"
  | "sessions"
  | "seconds"
  | "dimensionless"
  | "boolean"
  | "category";

export interface CausalEffectValue {
  readonly scale: EffectScale;
  readonly value: number;
  readonly unit: CausalUnit;
}

export interface TimeWindow {
  readonly start: UtcTimestamp;
  readonly end: UtcTimestamp;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

export function probability(value: number): Probability {
  assertFinite(value, "probability");
  if (value < 0 || value > 1) throw new RangeError("probability must be within [0,1]");
  return value as Probability;
}

export function moneyMinor(value: number): MoneyMinor {
  assertFinite(value, "moneyMinor");
  if (!Number.isInteger(value)) throw new RangeError("moneyMinor must be an integer");
  return value as MoneyMinor;
}

export function nonNegative(value: number): NonNegativeNumber {
  assertFinite(value, "nonNegative");
  if (value < 0) throw new RangeError("value must be non-negative");
  return value as NonNegativeNumber;
}

export function positive(value: number): PositiveNumber {
  assertFinite(value, "positive");
  if (value <= 0) throw new RangeError("value must be > 0");
  return value as PositiveNumber;
}

export function durationSeconds(value: number): DurationSeconds {
  assertFinite(value, "durationSeconds");
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("durationSeconds must be a non-negative integer");
  }
  return value as DurationSeconds;
}

export function utcTimestamp(value: string): UtcTimestamp {
  if (!Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) {
    throw new RangeError("timestamp must be valid UTC ISO-8601 ending in Z");
  }
  return value as UtcTimestamp;
}

export function currencyCode(value: string): CurrencyCode {
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new RangeError("currencyCode must be a three-letter ISO-style code");
  }
  return value as CurrencyCode;
}

export function assertTimeWindow(window: TimeWindow): void {
  if (Date.parse(window.start) > Date.parse(window.end)) {
    throw new RangeError("time window start must not be after end");
  }
}
