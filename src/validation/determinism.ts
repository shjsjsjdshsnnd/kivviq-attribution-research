import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { canonicalActionFingerprints, hasExactKeys, isFingerprint, isNonEmptyString, isRecord, isStrictJson, issue, result, safeFingerprint } from "./shared.js";
import { FROZEN_BASELINE_VALIDATION_SEED_SET, type BaselineValidationSeeds } from "./seed-sets.js";

export interface DeterministicDecisionSample {
  readonly sampleId: string;
  readonly canonicalInputFingerprint: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly seedBindingFingerprint: string;
  readonly actions: readonly unknown[];
  readonly decisionEnvelope: unknown;
}

export interface CompleteRunSample {
  readonly sampleId: string;
  readonly canonicalInputFingerprint: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly seedSetFingerprint: string;
  readonly decisionOpportunities: unknown;
  readonly observations: unknown;
  readonly outputs: unknown;
  readonly dispositions: unknown;
  readonly executedActions: readonly unknown[];
  readonly simulatorOutcomeFingerprint: string;
  readonly metrics: readonly unknown[];
  readonly provenanceFingerprint: string;
}

export interface SeedReproducibilitySample {
  readonly sampleId: string;
  readonly seedSetVersion: string;
  readonly seedSetFingerprint: string;
  readonly seedCaseId: string;
  readonly seeds: BaselineValidationSeeds;
  readonly seedBindingFingerprint: string;
  readonly environmentFingerprint: string;
  readonly canonicalInputFingerprint: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly runFingerprint: string;
}

const DECISION_KEYS = ["sampleId", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedBindingFingerprint", "actions", "decisionEnvelope"] as const;
const RUN_KEYS = ["sampleId", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedSetFingerprint", "decisionOpportunities", "observations", "outputs", "dispositions", "executedActions", "simulatorOutcomeFingerprint", "metrics", "provenanceFingerprint"] as const;
const SEED_KEYS = ["sampleId", "seedSetVersion", "seedSetFingerprint", "seedCaseId", "seeds", "seedBindingFingerprint", "environmentFingerprint", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "runFingerprint"] as const;

function validateCollection(value: unknown, minimum: number, keys: readonly string[], label: string): { entries: Record<string, unknown>[]; issues: BaselineValidationIssue[] } {
  const issues: BaselineValidationIssue[] = [];
  if (!Array.isArray(value) || value.length < minimum) return { entries: [], issues: [issue("INSUFFICIENT_EVIDENCE", "evidence", `${label} requires at least ${minimum} samples`)] };
  const entries: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const path = `evidence[${index}]`;
    if (!isRecord(entry) || !hasExactKeys(entry, keys)) { issues.push(issue("INVALID_EVIDENCE", path, `${label} sample must be an exact evidence object`)); return; }
    if (!isNonEmptyString(entry["sampleId"]) || ids.has(entry["sampleId"] as string)) issues.push(issue("INVALID_SAMPLE_ID", `${path}.sampleId`, "sample IDs must be non-empty and unique"));
    else ids.add(entry["sampleId"]);
    entries.push(entry);
  });
  return { entries, issues };
}

function commonBindings(entries: readonly Record<string, unknown>[], names: readonly string[], issues: BaselineValidationIssue[]): void {
  if (entries.length === 0) return;
  for (const name of names) {
    const values = entries.map((entry) => entry[name]);
    if (values.some((value) => !isFingerprint(value))) issues.push(issue("INVALID_BINDING_FINGERPRINT", `evidence.${name}`, `${name} must be a canonical fingerprint`));
    else if (new Set(values).size !== 1) issues.push(issue("INCONSISTENT_EVIDENCE_BINDING", `evidence.${name}`, `${name} must be identical across samples`));
  }
}

function decisionValidation(value: unknown, minimum: number, checkId: BaselineValidationCheckId, divergenceCode: string): BaselineValidationCheckResult {
  if (!isStrictJson(value)) return result(checkId, [issue("INVALID_JSON_EVIDENCE", "evidence", "decision evidence must be strict deterministic JSON")], []);
  const checked = validateCollection(value, minimum, DECISION_KEYS, "decision evidence");
  const fingerprints: string[] = [];
  commonBindings(checked.entries, ["canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedBindingFingerprint"], checked.issues);
  const projections: string[] = [];
  checked.entries.forEach((entry, index) => {
    const path = `evidence[${index}]`;
    const actions = canonicalActionFingerprints(entry["actions"]);
    const envelope = entry["decisionEnvelope"];
    if (!isRecord(envelope)) {
      checked.issues.push(issue("INVALID_DECISION_EVIDENCE", path, "decisionEnvelope must be a strict plain object containing the same canonical Action[] as the decision")); return;
    }
    const envelopeActions = canonicalActionFingerprints(envelope["actions"]);
    if (actions === undefined || envelopeActions === undefined || JSON.stringify(actions) !== JSON.stringify(envelopeActions)) {
      checked.issues.push(issue("INVALID_DECISION_EVIDENCE", path, "decisionEnvelope must be a strict plain object containing the same canonical Action[] as the decision")); return;
    }
    const projection = { actions, decisionEnvelope: { ...envelope, actions: envelopeActions } };
    const fingerprint = safeFingerprint(projection);
    if (fingerprint === undefined) checked.issues.push(issue("INVALID_DECISION_EVIDENCE", path, "decision projection must be strict JSON"));
    else { fingerprints.push(fingerprint); projections.push(fingerprint); }
  });
  if (checked.issues.length === 0 && new Set(projections).size !== 1) checked.issues.push(issue(divergenceCode, "evidence", "identical inputs produced different policy decisions"));
  return result(checkId, checked.issues, fingerprints);
}

export function validateDeterministicDecisions(decisions: readonly DeterministicDecisionSample[]): BaselineValidationCheckResult {
  return decisionValidation(decisions, 2, "determinism", "NONDETERMINISTIC_DECISION");
}

export function detectUncontrolledRandomness(decisions: readonly DeterministicDecisionSample[]): BaselineValidationCheckResult {
  return decisionValidation(decisions, 3, "uncontrolled_randomness_detection", "UNCONTROLLED_RANDOMNESS_DETECTED");
}

export function validateCompleteRunReproducibility(runs: readonly CompleteRunSample[]): BaselineValidationCheckResult {
  if (!isStrictJson(runs)) return result("determinism", [issue("INVALID_JSON_EVIDENCE", "evidence", "complete-run evidence must be strict deterministic JSON")], []);
  const checked = validateCollection(runs, 2, RUN_KEYS, "complete-run evidence");
  const fingerprints: string[] = [];
  commonBindings(checked.entries, ["canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedSetFingerprint"], checked.issues);
  const projections: string[] = [];
  checked.entries.forEach((entry, index) => {
    const arrayFields = ["decisionOpportunities", "observations", "outputs", "dispositions", "metrics"];
    const fingerprintFields = ["simulatorOutcomeFingerprint", "provenanceFingerprint"];
    const executedActions = canonicalActionFingerprints(entry["executedActions"]);
    if (executedActions === undefined || arrayFields.some((name) => !Array.isArray(entry[name])) || (entry["decisionOpportunities"] as readonly unknown[] | undefined)?.length === 0 || fingerprintFields.some((name) => !isFingerprint(entry[name]))) checked.issues.push(issue("INVALID_COMPLETE_RUN_EVIDENCE", `evidence[${index}]`, "complete-run projection requires non-empty decision opportunities, array sections, canonical executed actions, and canonical fingerprints"));
    else { const fingerprint = evaluationFingerprint({ ...Object.fromEntries([...arrayFields, ...fingerprintFields].map((name) => [name, entry[name]])), executedActions }); projections.push(fingerprint); fingerprints.push(fingerprint); }
  });
  if (checked.issues.length === 0 && new Set(projections).size !== 1) checked.issues.push(issue("NON_REPRODUCIBLE_COMPLETE_RUN", "evidence", "complete-run projections differ"));
  return result("determinism", checked.issues, fingerprints);
}

export function validateSeedReproducibility(seedRuns: readonly SeedReproducibilitySample[]): BaselineValidationCheckResult {
  if (!isStrictJson(seedRuns)) return result("seed_reproducibility", [issue("INVALID_JSON_EVIDENCE", "evidence", "seed reproducibility evidence must be strict deterministic JSON")], []);
  const checked = validateCollection(seedRuns, 4, SEED_KEYS, "seed reproducibility evidence");
  commonBindings(checked.entries, ["seedSetFingerprint", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint"], checked.issues);
  const runFingerprints: string[] = [];
  checked.entries.forEach((entry, index) => {
    const frozenCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.find((candidate) => candidate.caseId === entry["seedCaseId"]);
    const exactFrozenBinding = entry["seedSetVersion"] === FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion
      && entry["seedSetFingerprint"] === FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint
      && frozenCase !== undefined
      && isRecord(entry["seeds"])
      && JSON.stringify(entry["seeds"]) === JSON.stringify(frozenCase.seeds)
      && entry["seedBindingFingerprint"] === evaluationFingerprint({ seedCaseId: frozenCase.caseId, seeds: frozenCase.seeds });
    if (!exactFrozenBinding) checked.issues.push(issue("INVALID_SEED_BINDING", `evidence[${index}]`, "seed evidence must bind an exact case from the frozen seed set"));
    if (!isFingerprint(entry["environmentFingerprint"])) checked.issues.push(issue("INVALID_SEED_BINDING", `evidence[${index}].environmentFingerprint`, "seed evidence must bind a canonical evaluator environment fingerprint"));
    if (!isFingerprint(entry["runFingerprint"])) checked.issues.push(issue("INVALID_RUN_FINGERPRINT", `evidence[${index}].runFingerprint`, "run fingerprint must be canonical"));
    else runFingerprints.push(entry["runFingerprint"]);
  });
  if (checked.issues.length === 0) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const entry of checked.entries) { const key = `${entry["seedCaseId"]}:${entry["seedBindingFingerprint"]}`; groups.set(key, [...(groups.get(key) ?? []), entry]); }
    if (groups.size < 2 || [...groups.values()].some((entries) => entries.length < 2)) checked.issues.push(issue("INSUFFICIENT_SEED_BINDINGS", "evidence", "two distinct seed bindings with two runs each are required"));
    else if ([...groups.values()].some((entries) => new Set(entries.map((entry) => entry["environmentFingerprint"])).size !== 1 || new Set(entries.map((entry) => entry["runFingerprint"])).size !== 1)) checked.issues.push(issue("SEED_REPRODUCIBILITY_FAILURE", "evidence", "the exact seed binding produced different evaluator environments or runs"));
    else if (new Set([...groups.values()].map((entries) => entries[0]!["environmentFingerprint"])).size !== groups.size || new Set([...groups.values()].map((entries) => entries[0]!["runFingerprint"])).size !== groups.size) checked.issues.push(issue("SEED_BINDING_NOT_MATERIALIZED", "evidence", "distinct frozen seeds must produce distinct evaluator environment and run fingerprints"));
  }
  return result("seed_reproducibility", checked.issues, runFingerprints);
}
