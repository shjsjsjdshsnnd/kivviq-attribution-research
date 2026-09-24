import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { compareCodeUnits, hasExactKeys, isNonEmptyString, isRecord, isStrictJson, issue, result } from "./shared.js";

export const TEMPORAL_OBSERVATION_KINDS = ["order", "conversion", "revenue", "customer_event", "inventory_event", "advertising_outcome", "return", "promotion_outcome"] as const;
export type TemporalObservationKind = typeof TEMPORAL_OBSERVATION_KINDS[number];
export interface TemporalObservation { readonly eventId: string; readonly kind: TemporalObservationKind; readonly occurredAt: string; readonly payload: unknown; }
export interface TemporalObservationBoundaryInput { readonly decisionTimestamp: string; readonly observations: readonly TemporalObservation[]; }
export interface LookbackWindowInput extends TemporalObservationBoundaryInput { readonly startInclusive: string; readonly endInclusive: string; }

const OBSERVATION_KEYS = ["eventId", "kind", "occurredAt", "payload"] as const;
const STRICT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function instant(value: unknown): number | undefined {
  if (typeof value !== "string" || !STRICT_INSTANT.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function observations(value: unknown, issues: BaselineValidationIssue[]): { values: Array<Record<string, unknown>>; times: number[] } {
  if (!Array.isArray(value)) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", "observations", "observations must be an array")); return { values: [], times: [] }; }
  const values: Array<Record<string, unknown>> = []; const times: number[] = []; const ids = new Set<string>(); let previousKey: string | undefined;
  value.forEach((raw, index) => {
    const path = `observations[${index}]`;
    if (!isRecord(raw) || !hasExactKeys(raw, OBSERVATION_KEYS) || !isNonEmptyString(raw["eventId"]) || ids.has(raw["eventId"] as string) || !(TEMPORAL_OBSERVATION_KINDS as readonly unknown[]).includes(raw["kind"]) || !isStrictJson(raw["payload"])) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", path, "observation must have an exact shape, unique ID, known kind, and strict JSON payload")); return; }
    const time = instant(raw["occurredAt"]);
    if (time === undefined) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", `${path}.occurredAt`, "occurredAt must be a strict ISO instant")); return; }
    ids.add(raw["eventId"]); const key = `${raw["occurredAt"]}\u0000${raw["eventId"]}`;
    if (previousKey !== undefined && compareCodeUnits(previousKey, key) > 0) issues.push(issue("UNSTABLE_OBSERVATION_ORDER", path, "observations must be ordered by occurredAt then eventId"));
    previousKey = key; values.push(raw); times.push(time);
  });
  return { values, times };
}

export function validateTemporalObservationBoundary(input: TemporalObservationBoundaryInput): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isStrictJson(input) || !isRecord(input) || !hasExactKeys(input, ["decisionTimestamp", "observations"])) return result("temporal_boundary_conformance", [issue("INVALID_TEMPORAL_EVIDENCE", "input", "temporal input must be strict deterministic JSON with the exact evidence shape")], []);
  const decision = instant(input["decisionTimestamp"]);
  if (decision === undefined) issues.push(issue("INVALID_TEMPORAL_EVIDENCE", "decisionTimestamp", "decisionTimestamp must be a strict ISO instant"));
  const checked = observations(input["observations"], issues);
  checked.times.forEach((time, index) => { if (decision !== undefined && time > decision) issues.push(issue("FUTURE_OBSERVATION", `observations[${index}].occurredAt`, "observation occurs after the decision timestamp")); });
  return result("temporal_boundary_conformance", issues, checked.values.map((value) => evaluationFingerprint(value)));
}

export function validateLookbackWindow(input: LookbackWindowInput): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isStrictJson(input) || !isRecord(input) || !hasExactKeys(input, ["startInclusive", "endInclusive", "decisionTimestamp", "observations"])) return result("lookback_window_conformance", [issue("INVALID_LOOKBACK_WINDOW", "input", "lookback input must be strict deterministic JSON with the exact evidence shape")], []);
  const start = instant(input["startInclusive"]); const end = instant(input["endInclusive"]); const decision = instant(input["decisionTimestamp"]);
  if (start === undefined || end === undefined || decision === undefined || start > end || decision !== end) issues.push(issue("INVALID_LOOKBACK_WINDOW", "input", "lookback requires strict instants with start <= end and decisionTimestamp equal to endInclusive"));
  const checked = observations(input["observations"], issues);
  checked.times.forEach((time, index) => { if (start !== undefined && end !== undefined && (time < start || time > end)) issues.push(issue("LOOKBACK_WINDOW_VIOLATION", `observations[${index}].occurredAt`, "observation lies outside the inclusive lookback window")); });
  return result("lookback_window_conformance", issues, checked.values.map((value) => evaluationFingerprint(value)));
}
