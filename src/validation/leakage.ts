import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { canonicalActionFingerprints, hasExactKeys, isFingerprint, isNonEmptyString, isRecord, isStrictJson, issue, result } from "./shared.js";

export interface InformationIsolationSide { readonly visibleInputFingerprint: string; readonly witness: object; readonly witnessFingerprint: string; readonly decisionFingerprint: string; readonly actions: readonly unknown[]; }
export interface InformationIsolationPair { readonly pairId: string; readonly baseline: InformationIsolationSide; readonly variant: InformationIsolationSide; }

const PAIR_KEYS = ["pairId", "baseline", "variant"] as const;
const SIDE_KEYS = ["visibleInputFingerprint", "witness", "witnessFingerprint", "decisionFingerprint", "actions"] as const;

export function canonicalPolicyDecisionFingerprint(actions: readonly unknown[]): string {
  const fingerprints = canonicalActionFingerprints(actions);
  if (fingerprints === undefined) throw new TypeError("actions must be canonical Action objects");
  return evaluationFingerprint(fingerprints);
}

function validateIsolation(value: unknown, checkId: BaselineValidationCheckId, leakageCode: string): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  const fingerprints: string[] = [];
  if (!isStrictJson(value) || !Array.isArray(value) || value.length === 0) return result(checkId, [issue("INVALID_PAIRED_EVIDENCE", "pairs", "paired evidence must be a non-empty strict deterministic JSON array")], []);
  const pairIds = new Set<string>();
  value.forEach((raw, index) => {
    const path = `pairs[${index}]`;
    if (!isRecord(raw) || !hasExactKeys(raw, PAIR_KEYS) || !isNonEmptyString(raw["pairId"]) || pairIds.has(raw["pairId"] as string)) { issues.push(issue("INVALID_PAIRED_EVIDENCE", path, "pair must have an exact shape and a unique non-empty pairId")); return; }
    pairIds.add(raw["pairId"]);
    if (!isRecord(raw["baseline"]) || !hasExactKeys(raw["baseline"], SIDE_KEYS) || !isRecord(raw["variant"]) || !hasExactKeys(raw["variant"], SIDE_KEYS)) { issues.push(issue("INVALID_PAIRED_EVIDENCE", path, "both pair sides must have the exact evidence shape")); return; }
    const baseline = raw["baseline"]; const variant = raw["variant"];
    const baselineActions = canonicalActionFingerprints(baseline["actions"]); const variantActions = canonicalActionFingerprints(variant["actions"]);
    const validWitnesses = isRecord(baseline["witness"]) && isStrictJson(baseline["witness"]) && isRecord(variant["witness"]) && isStrictJson(variant["witness"])
      && baseline["witnessFingerprint"] === evaluationFingerprint(baseline["witness"])
      && variant["witnessFingerprint"] === evaluationFingerprint(variant["witness"]);
    const validFingerprints = [baseline["visibleInputFingerprint"], baseline["witnessFingerprint"], baseline["decisionFingerprint"], variant["visibleInputFingerprint"], variant["witnessFingerprint"], variant["decisionFingerprint"]].every(isFingerprint);
    const recordedMatch = baselineActions !== undefined && variantActions !== undefined && baseline["decisionFingerprint"] === canonicalPolicyDecisionFingerprint(baseline["actions"] as readonly unknown[]) && variant["decisionFingerprint"] === canonicalPolicyDecisionFingerprint(variant["actions"] as readonly unknown[]);
    if (!validWitnesses || !validFingerprints || !recordedMatch || baseline["visibleInputFingerprint"] !== variant["visibleInputFingerprint"] || baseline["witnessFingerprint"] === variant["witnessFingerprint"]) { issues.push(issue("INVALID_PAIRED_EVIDENCE", path, "visible inputs must match, witnesses must be strict bound objects and differ, and decision fingerprints must match canonical actions")); return; }
    fingerprints.push(evaluationFingerprint({ pairId: raw["pairId"], visibleInputFingerprint: baseline["visibleInputFingerprint"], baselineWitnessFingerprint: baseline["witnessFingerprint"], variantWitnessFingerprint: variant["witnessFingerprint"], baselineDecisionFingerprint: baseline["decisionFingerprint"], variantDecisionFingerprint: variant["decisionFingerprint"] }));
    if (JSON.stringify(baselineActions) !== JSON.stringify(variantActions) || baseline["decisionFingerprint"] !== variant["decisionFingerprint"]) issues.push(issue(leakageCode, path, "policy decision changed when only evaluator-owned information changed"));
  });
  return result(checkId, issues, fingerprints);
}

export function validateHiddenTruthIsolation(pairs: readonly InformationIsolationPair[]): BaselineValidationCheckResult { return validateIsolation(pairs, "hidden_truth_isolation", "HIDDEN_TRUTH_LEAKAGE"); }
export function validateFutureInformationIsolation(pairs: readonly InformationIsolationPair[]): BaselineValidationCheckResult { return validateIsolation(pairs, "future_information_isolation", "FUTURE_INFORMATION_LEAKAGE"); }
export function validateProhibitedInformationInvariance(pairs: readonly InformationIsolationPair[]): BaselineValidationCheckResult { return validateIsolation(pairs, "prohibited_information_invariance", "PROHIBITED_INFORMATION_LEAKAGE"); }
