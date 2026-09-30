import { INPUT_VERSION, METRIC_IDS } from "./contract.js";
import type { DiagnosisInput, MetricId, Unit } from "./contract.js";

export class DiagnosisInputError extends Error {
  override readonly name = "DiagnosisInputError";
}
const limit = Number.MAX_SAFE_INTEGER / 32;
export const EXPECTED_UNIT: Readonly<Record<MetricId, Unit>> = {
  revenue_net: "MONEY", orders: "COUNT", aov: "MONEY", sessions: "COUNT", cvr: "RATIO",
};
function fail(path: string, message: string): never {
  throw new DiagnosisInputError(`${path}: ${message}`);
}
function object(value: unknown, keys: readonly string[], path: string, requireAll = true): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, "expected plain data object");
  const result = value as Record<string, unknown>;
  if (Reflect.ownKeys(result).some(key => typeof key !== "string" || !keys.includes(key))) fail(path, "unexpected field; input must be observable-only");
  if (Object.values(Object.getOwnPropertyDescriptors(result)).some(descriptor => !("value" in descriptor))) fail(path, "accessor properties are not observable data");
  if (Object.values(Object.getOwnPropertyDescriptors(result)).some(descriptor => !descriptor.enumerable)) fail(path, "non-enumerable properties cannot be replayed as JSON");
  if (requireAll && keys.some(key => !Object.hasOwn(result, key))) fail(path, "required own property missing");
  return result;
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) fail(path, "expected nonempty bounded string");
}
export function timestamp(value: unknown, path: string): number {
  text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail(path, "expected UTC timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    fail(path, "invalid calendar timestamp");
  }
  return parsed;
}
function number(value: unknown, path: string, minimum = -limit, maximum = limit): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, "expected finite number within supported range");
  }
}
function bool(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(path, "expected explicit boolean");
}
const sourceNames = ["SHOPIFY", "GA4", "DERIVED", "GOOGLE_ADS", "META_ADS", "PINTEREST_ADS", "OMNISEND", "KLAVIYO", "FIRST_PARTY", "MERCHANT_CONFIG"];

/** Strict runtime boundary: no permissive spreading of evaluator or model fields. */
export function parseDiagnosisInput(raw: unknown): DiagnosisInput {
  const input = object(raw, ["version", "snapshotId", "merchantId", "asOf", "currency", "minorUnitsPerMajor", "comparisonKind", "metrics", "policy"], "input");
  if (input["version"] !== INPUT_VERSION) fail("version", "unsupported diagnosis input version");
  text(input["snapshotId"], "snapshotId"); text(input["merchantId"], "merchantId");
  timestamp(input["asOf"], "asOf");
  if (typeof input["currency"] !== "string" || !/^[A-Z]{3}$/.test(input["currency"])) fail("currency", "expected three-letter currency code");
  if (![1, 10, 100, 1000].includes(input["minorUnitsPerMajor"] as number)) fail("minorUnitsPerMajor", "explicit currency scale is required");
  if (!["PREVIOUS", "YOY", "SEASONAL_BASELINE"].includes(input["comparisonKind"] as string)) fail("comparisonKind", "unsupported comparison");
  if (!Array.isArray(input["metrics"]) || input["metrics"].length > METRIC_IDS.length) fail("metrics", "expected a bounded metric array");
  if (Object.getPrototypeOf(input["metrics"]) !== Array.prototype || Reflect.ownKeys(input["metrics"]).some(key => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) fail("metrics", "unexpected array metadata");
  if (Object.values(Object.getOwnPropertyDescriptors(input["metrics"])).some(descriptor => !("value" in descriptor))) fail("metrics", "accessor properties are not observable data");
  if (Object.entries(Object.getOwnPropertyDescriptors(input["metrics"])).some(([key, descriptor]) => key !== "length" && !descriptor.enumerable)) fail("metrics", "non-enumerable elements cannot be replayed as JSON");
  const seen = new Set<string>(), evidenceIds = new Set<string>();
  for (const [index, rawMetric] of input["metrics"].entries()) {
    const path = `metrics[${index}]`;
    const metric = object(rawMetric, ["metricId", "unit", "reference", "current"], path);
    if (!METRIC_IDS.includes(metric["metricId"] as MetricId)) fail(path, "unsupported metric ID; metric substitution is forbidden");
    const id = metric["metricId"] as MetricId;
    if (seen.has(id)) fail(path, "duplicate metric ID");
    seen.add(id);
    if (metric["unit"] !== EXPECTED_UNIT[id]) fail(path, "canonical unit mismatch");
    for (const period of ["reference", "current"] as const) {
      const p = `${path}.${period}`;
      const observation = object(metric[period], ["value", "merchantId", "scopeId", "populationId", "definitionId", "measurementId", "source", "evidenceId", "observedAt", "dataThrough", "coverage", "complete", "sourceScanComplete", "window", "currency"], p);
      for (const field of ["merchantId", "scopeId", "populationId", "definitionId", "measurementId"]) text(observation[field], `${p}.${field}`);
      if (observation["value"] !== null) {
        number(observation["value"], `${p}.value`);
        if (metric["unit"] === "COUNT" && (!Number.isSafeInteger(observation["value"]) || observation["value"] < 0)) fail(p, "counts must be nonnegative integers");
        if (id === "revenue_net" && !Number.isSafeInteger(observation["value"])) fail(p, "revenue must use integer minor units");
        if (id === "cvr" && observation["value"] < 0) fail(p, "conversion ratio cannot be negative");
      }
      if (observation["source"] !== null && !sourceNames.includes(observation["source"] as string)) fail(p, "unrecognized canonical source");
      if (observation["evidenceId"] !== null) {
        text(observation["evidenceId"], `${p}.evidenceId`);
        if (evidenceIds.has(observation["evidenceId"])) fail(p, "atomic evidence IDs must be unique");
        evidenceIds.add(observation["evidenceId"]);
      }
      for (const field of ["observedAt", "dataThrough"] as const) if (observation[field] !== null) timestamp(observation[field], `${p}.${field}`);
      if (observation["coverage"] !== null) number(observation["coverage"], `${p}.coverage`, 0, 1);
      bool(observation["complete"], `${p}.complete`); bool(observation["sourceScanComplete"], `${p}.sourceScanComplete`);
      const window = object(observation["window"], ["start", "end"], `${p}.window`);
      if (timestamp(window["start"], `${p}.window.start`) >= timestamp(window["end"], `${p}.window.end`)) fail(p, "window must have positive duration");
      if (metric["unit"] === "MONEY") {
        if (typeof observation["currency"] !== "string" || !/^[A-Z]{3}$/.test(observation["currency"])) fail(p, "monetary observation needs currency");
      } else if (observation["currency"] !== null) fail(p, "nonmonetary observation cannot carry currency");
    }
  }
  const policy = object(input["policy"], ["materiality", "minimumCoverage", "maxAgeSeconds", "identityToleranceMinorUnits"], "policy");
  number(policy["minimumCoverage"], "policy.minimumCoverage", 0, 1);
  number(policy["maxAgeSeconds"], "policy.maxAgeSeconds", 0);
  number(policy["identityToleranceMinorUnits"], "policy.identityToleranceMinorUnits", 0, 1);
  const rules = object(policy["materiality"], METRIC_IDS, "policy.materiality", false);
  for (const id of seen) if (!Object.hasOwn(rules, id)) fail("policy.materiality", "every supplied metric requires a rule");
  for (const id of Object.keys(rules)) {
    const rule = object(rules[id], ["absolute", "relative"], `policy.materiality.${id}`);
    number(rule["absolute"], "materiality.absolute", 0);
    number(rule["relative"], "materiality.relative", 0, 1);
  }
  // This cast follows field-by-field runtime validation, not trust in caller types.
  return raw as DiagnosisInput;
}
