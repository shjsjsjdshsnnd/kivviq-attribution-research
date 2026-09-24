import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { canonicalActionFingerprints, hasExactKeys, isFingerprint, isNonEmptyString, isRecord, isStrictJson, issue, result, safeFingerprint } from "./shared.js";

export interface DeterministicDecisionSample {
  readonly sampleId: string;
  readonly canonicalInputFingerprint: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly seedBindingFingerprint: string;
  readonly actions: readonly unknown[];
  readonly decisionEnvelope: unknown;
  readonly provenanceOnlyPaths: readonly string[];
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
  readonly metricsFingerprint: string;
  readonly provenanceFingerprint: string;
}

export interface SeedReproducibilitySample {
  readonly sampleId: string;
  readonly seedSetFingerprint: string;
  readonly canonicalInputFingerprint: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly runFingerprint: string;
}

const DECISION_KEYS = ["sampleId", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedBindingFingerprint", "actions", "decisionEnvelope", "provenanceOnlyPaths"] as const;
const RUN_KEYS = ["sampleId", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "seedSetFingerprint", "decisionOpportunities", "observations", "outputs", "dispositions", "executedActions", "simulatorOutcomeFingerprint", "metricsFingerprint", "provenanceFingerprint"] as const;
const SEED_KEYS = ["sampleId", "seedSetFingerprint", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint", "runFingerprint"] as const;

function omitPaths(value: unknown, paths: readonly string[]): unknown {
  const clone = JSON.parse(JSON.stringify(value)) as unknown;
  for (const path of paths) {
    const segments = path.split(".");
    if (segments.some((segment) => segment.length === 0)) continue;
    let current = clone;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!isRecord(current)) { current = undefined; break; }
      current = current[segments[index]!];
    }
    if (isRecord(current)) delete current[segments.at(-1)!];
  }
  return clone;
}

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
  let expectedPaths: string | undefined;
  const projections: string[] = [];
  checked.entries.forEach((entry, index) => {
    const path = `evidence[${index}]`;
    const actions = canonicalActionFingerprints(entry["actions"]);
    if (actions === undefined || !isStrictJson(entry["decisionEnvelope"]) || !Array.isArray(entry["provenanceOnlyPaths"]) || entry["provenanceOnlyPaths"].some((item) => !isNonEmptyString(item)) || new Set(entry["provenanceOnlyPaths"]).size !== entry["provenanceOnlyPaths"].length) {
      checked.issues.push(issue("INVALID_DECISION_EVIDENCE", path, "decision evidence must contain canonical actions, strict JSON metadata, and provenance paths")); return;
    }
    const paths = [...entry["provenanceOnlyPaths"]].sort();
    const pathsKey = JSON.stringify(paths);
    if (expectedPaths === undefined) expectedPaths = pathsKey;
    else if (expectedPaths !== pathsKey) { checked.issues.push(issue("INCONSISTENT_PROVENANCE_EXCLUSIONS", `${path}.provenanceOnlyPaths`, "provenance exclusions must be identical across samples")); return; }
    const projection = { actions, decisionEnvelope: omitPaths(entry["decisionEnvelope"], paths) };
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
    const jsonFields = ["decisionOpportunities", "observations", "outputs", "dispositions"];
    const fingerprintFields = ["simulatorOutcomeFingerprint", "metricsFingerprint", "provenanceFingerprint"];
    const executedActions = canonicalActionFingerprints(entry["executedActions"]);
    if (executedActions === undefined || jsonFields.some((name) => !isStrictJson(entry[name])) || fingerprintFields.some((name) => !isFingerprint(entry[name]))) checked.issues.push(issue("INVALID_COMPLETE_RUN_EVIDENCE", `evidence[${index}]`, "complete-run projection must contain strict JSON, canonical executed actions, and canonical fingerprints"));
    else { const fingerprint = evaluationFingerprint({ ...Object.fromEntries([...jsonFields, ...fingerprintFields].map((name) => [name, entry[name]])), executedActions }); projections.push(fingerprint); fingerprints.push(fingerprint); }
  });
  if (checked.issues.length === 0 && new Set(projections).size !== 1) checked.issues.push(issue("NON_REPRODUCIBLE_COMPLETE_RUN", "evidence", "complete-run projections differ"));
  return result("determinism", checked.issues, fingerprints);
}

export function validateSeedReproducibility(seedRuns: readonly SeedReproducibilitySample[]): BaselineValidationCheckResult {
  if (!isStrictJson(seedRuns)) return result("seed_reproducibility", [issue("INVALID_JSON_EVIDENCE", "evidence", "seed reproducibility evidence must be strict deterministic JSON")], []);
  const checked = validateCollection(seedRuns, 2, SEED_KEYS, "seed reproducibility evidence");
  commonBindings(checked.entries, ["seedSetFingerprint", "canonicalInputFingerprint", "operatorFingerprint", "configurationFingerprint"], checked.issues);
  const runFingerprints: string[] = [];
  checked.entries.forEach((entry, index) => {
    if (!isFingerprint(entry["runFingerprint"])) checked.issues.push(issue("INVALID_RUN_FINGERPRINT", `evidence[${index}].runFingerprint`, "run fingerprint must be canonical"));
    else runFingerprints.push(entry["runFingerprint"]);
  });
  if (checked.issues.length === 0 && new Set(runFingerprints).size !== 1) checked.issues.push(issue("SEED_REPRODUCIBILITY_FAILURE", "evidence", "the exact seed binding produced different runs"));
  return result("seed_reproducibility", checked.issues, runFingerprints);
}
