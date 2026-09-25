import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import { utcTimestamp } from "../core/units.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { compareCodeUnits, hasExactKeys, isFingerprint, isNonEmptyString, isRecord, isStrictJson, issue, result } from "./shared.js";

export const TEMPORAL_OBSERVATION_KINDS = ["order", "conversion", "revenue", "customer_event", "inventory_event", "advertising_outcome", "return", "promotion_outcome"] as const;
export type TemporalObservationKind = typeof TEMPORAL_OBSERVATION_KINDS[number];
export interface TemporalObservation { readonly eventId: string; readonly kind: TemporalObservationKind; readonly occurredAt: string; readonly payload: unknown; }
export interface TemporalObservationBoundaryInput { readonly decisionTimestamp: string; readonly observationFingerprint: string; readonly observations: readonly TemporalObservation[]; }
export interface LookbackWindowInput extends TemporalObservationBoundaryInput { readonly startInclusive: string; readonly endInclusive: string; }
interface BoundObservationRecord { readonly observationKey: string; readonly value: unknown; readonly sourceMinOccurredAt: string; readonly sourceMaxOccurredAt: string; }

const OBSERVATION_KEYS = ["eventId", "kind", "occurredAt", "payload"] as const;
const STRICT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function instant(value: unknown): number | undefined {
  if (typeof value !== "string" || !STRICT_INSTANT.test(value)) return undefined;
  try {
    utcTimestamp(value);
    const parsed = Date.parse(value);
    const normalized = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
    return new Date(parsed).toISOString() === normalized ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function observations(value: unknown, issues: BaselineValidationIssue[]): Array<{ index: number; value: Record<string, unknown>; time: number }> {
  if (!Array.isArray(value)) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", "observations", "observations must be an array")); return []; }
  const entries: Array<{ index: number; value: Record<string, unknown>; time: number }> = []; const ids = new Set<string>(); let previous: { time: number; eventId: string } | undefined;
  value.forEach((raw, index) => {
    const path = `observations[${index}]`;
    if (!isRecord(raw) || !hasExactKeys(raw, OBSERVATION_KEYS) || !isNonEmptyString(raw["eventId"]) || ids.has(raw["eventId"] as string) || !(TEMPORAL_OBSERVATION_KINDS as readonly unknown[]).includes(raw["kind"]) || !isStrictJson(raw["payload"])) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", path, "observation must have an exact shape, unique ID, known kind, and strict JSON payload")); return; }
    const time = instant(raw["occurredAt"]);
    if (time === undefined) { issues.push(issue("INVALID_TEMPORAL_EVIDENCE", `${path}.occurredAt`, "occurredAt must be a strict ISO instant")); return; }
    const eventId = raw["eventId"];
    ids.add(eventId);
    if (previous !== undefined && (previous.time > time || (previous.time === time && compareCodeUnits(previous.eventId, eventId) > 0))) issues.push(issue("UNSTABLE_OBSERVATION_ORDER", path, "observations must be ordered by occurredAt then eventId"));
    previous = { time, eventId }; entries.push({ index, value: raw, time });
  });
  return entries;
}

function validateBindings(checked: readonly { index: number; time: number; value: Record<string, unknown> }[], observationFingerprint: string | undefined, expectedRecords: readonly BoundObservationRecord[] | undefined, boundary: "latest" | "window", issues: BaselineValidationIssue[]): void {
  if (observationFingerprint === undefined || expectedRecords === undefined) return;
  if (expectedRecords.length > 0 && checked.length === 0) { issues.push(issue("MISSING_BOUND_TEMPORAL_EVIDENCE", "observations", "non-empty canonical observations require bound temporal evidence")); return; }
  const expected = new Set(expectedRecords.flatMap((record) => {
    const identity = `${record.observationKey}:${evaluationFingerprint(record.value)}`;
    return boundary === "latest" ? [`${identity}:${record.sourceMaxOccurredAt}`] : [...new Set([record.sourceMinOccurredAt, record.sourceMaxOccurredAt])].map((timestamp) => `${identity}:${timestamp}`);
  }));
  const actual = new Set<string>();
  for (const { index, value } of checked) {
    const payload = value["payload"];
    const occurredAt = value["occurredAt"];
    const identity = isRecord(payload) && isNonEmptyString(payload["observationKey"]) && isFingerprint(payload["dataFingerprint"]) && isNonEmptyString(occurredAt) ? `${payload["observationKey"]}:${payload["dataFingerprint"]}:${occurredAt}` : "";
    if (!isRecord(payload) || !hasExactKeys(payload, ["observationKey", "observationFingerprint", "data", "dataFingerprint"]) || payload["observationFingerprint"] !== observationFingerprint || !isNonEmptyString(payload["observationKey"]) || !isFingerprint(payload["dataFingerprint"]) || payload["dataFingerprint"] !== evaluationFingerprint(payload["data"]) || !expected.has(identity)) issues.push(issue("OBSERVATION_BINDING_MISMATCH", `observations[${index}].payload`, "temporal payload and timestamp must reproduce a canonical input observation and its source boundary"));
    else actual.add(identity);
  }
  if (actual.size !== expected.size || [...expected].some((identity) => !actual.has(identity))) issues.push(issue("OBSERVATION_BINDING_MISMATCH", "observations", "temporal evidence must cover every canonical observation source boundary exactly"));
}

export function validateTemporalObservationBoundary(input: TemporalObservationBoundaryInput, expectedObservationFingerprint?: string, expectedRecords?: readonly BoundObservationRecord[], expectedDecisionTimestamp?: string): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isStrictJson(input) || !isRecord(input) || !hasExactKeys(input, ["decisionTimestamp", "observationFingerprint", "observations"])) return result("temporal_boundary_conformance", [issue("INVALID_TEMPORAL_EVIDENCE", "input", "temporal input must be strict deterministic JSON with the exact evidence shape")], []);
  if (!isFingerprint(input["observationFingerprint"]) || (expectedObservationFingerprint !== undefined && input["observationFingerprint"] !== expectedObservationFingerprint)) issues.push(issue("OBSERVATION_BINDING_MISMATCH", "observationFingerprint", "temporal evidence must bind the canonical input observation fingerprint"));
  if (expectedDecisionTimestamp !== undefined && input["decisionTimestamp"] !== expectedDecisionTimestamp) issues.push(issue("TEMPORAL_BINDING_MISMATCH", "decisionTimestamp", "temporal decision timestamp must equal the canonical input decision time"));
  const decision = instant(input["decisionTimestamp"]);
  if (decision === undefined) issues.push(issue("INVALID_TEMPORAL_EVIDENCE", "decisionTimestamp", "decisionTimestamp must be a strict ISO instant"));
  const checked = observations(input["observations"], issues);
  validateBindings(checked, expectedObservationFingerprint, expectedRecords, "latest", issues);
  checked.forEach(({ index, time }) => { if (decision !== undefined && time > decision) issues.push(issue("FUTURE_OBSERVATION", `observations[${index}].occurredAt`, "observation occurs after the decision timestamp")); });
  return result("temporal_boundary_conformance", issues, checked.map(({ value }) => evaluationFingerprint(value)));
}

export function validateLookbackWindow(input: LookbackWindowInput, expectedObservationFingerprint?: string, expectedRecords?: readonly BoundObservationRecord[], expectedDecisionTimestamp?: string): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isStrictJson(input) || !isRecord(input) || !hasExactKeys(input, ["startInclusive", "endInclusive", "decisionTimestamp", "observationFingerprint", "observations"])) return result("lookback_window_conformance", [issue("INVALID_LOOKBACK_WINDOW", "input", "lookback input must be strict deterministic JSON with the exact evidence shape")], []);
  if (!isFingerprint(input["observationFingerprint"]) || (expectedObservationFingerprint !== undefined && input["observationFingerprint"] !== expectedObservationFingerprint)) issues.push(issue("OBSERVATION_BINDING_MISMATCH", "observationFingerprint", "lookback evidence must bind the canonical input observation fingerprint"));
  if (expectedDecisionTimestamp !== undefined) {
    const expectedStart = expectedRecords?.reduce((earliest, record) => Date.parse(record.sourceMinOccurredAt) < Date.parse(earliest) ? record.sourceMinOccurredAt : earliest, expectedDecisionTimestamp) ?? expectedDecisionTimestamp;
    if (input["decisionTimestamp"] !== expectedDecisionTimestamp || input["endInclusive"] !== expectedDecisionTimestamp || input["startInclusive"] !== expectedStart) issues.push(issue("TEMPORAL_BINDING_MISMATCH", "input", "lookback boundaries must equal the canonical decision time and observation source window"));
  }
  const start = instant(input["startInclusive"]); const end = instant(input["endInclusive"]); const decision = instant(input["decisionTimestamp"]);
  if (start === undefined || end === undefined || decision === undefined || start > end || decision !== end) issues.push(issue("INVALID_LOOKBACK_WINDOW", "input", "lookback requires strict instants with start <= end and decisionTimestamp equal to endInclusive"));
  const checked = observations(input["observations"], issues);
  validateBindings(checked, expectedObservationFingerprint, expectedRecords, "window", issues);
  checked.forEach(({ index, time }) => { if (start !== undefined && end !== undefined && (time < start || time > end)) issues.push(issue("LOOKBACK_WINDOW_VIOLATION", `observations[${index}].occurredAt`, "observation lies outside the inclusive lookback window")); });
  return result("lookback_window_conformance", issues, checked.map(({ value }) => evaluationFingerprint(value)));
}
