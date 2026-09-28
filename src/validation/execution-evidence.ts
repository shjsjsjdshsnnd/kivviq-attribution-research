import { deepFreezeEvaluation, evaluationFingerprint, stableEvaluationJson } from "../evaluation/baseline-contract.js";
import { assertCanonicalOperatorInputV2, canonicalInputFingerprint, canonicalOperatorDecisionFingerprint, validateCanonicalDecisionEnvelope, type CanonicalOperatorInputV2, type CanonicalOperatorV2 } from "../operator/canonical-interface.js";
import { BaselineValidationError, type BaselineValidationCheckResult } from "./contract.js";
import { detectUncontrolledRandomness, validateDeterministicDecisions, validateSeedReproducibility, type DeterministicDecisionSample, type SeedReproducibilitySample } from "./determinism.js";
import { canonicalPolicyDecisionFingerprint, validateFutureInformationIsolation, validateHiddenTruthIsolation, type InformationIsolationPair } from "./leakage.js";
import { FROZEN_BASELINE_VALIDATION_SEED_SET, type BaselineValidationSeedCase, type BaselineValidationSeeds, type BaselineValidationWorldProfile } from "./seed-sets.js";
import { hasExactKeys, isFingerprint, isRecord, isStrictJson, issue, result } from "./shared.js";

export const DETERMINISM_REPETITIONS = 2 as const;
export const RANDOMNESS_PROBES = 3 as const;
export const SEED_REPETITIONS = 2 as const;

export interface ValidationOperatorExecutionBinding {
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly implementationFingerprint: string;
  readonly configurationFingerprint: string;
  readonly adapterFingerprint: string;
}
export interface DeclarativeRepeatedExecutionEvidence {
  readonly operatorBinding: ValidationOperatorExecutionBinding;
  readonly canonicalInput: CanonicalOperatorInputV2;
  readonly canonicalInputFingerprint: string;
}
export interface DeclarativeFrozenSeedCaseBinding {
  readonly seedSetVersion: string;
  readonly seedSetFingerprint: string;
  readonly seedCaseId: string;
  readonly worldProfile: BaselineValidationWorldProfile;
  readonly seeds: BaselineValidationSeeds;
  readonly seedBindingFingerprint: string;
}
export interface DeclarativeSeedExecutionEvidence {
  readonly operatorBinding: ValidationOperatorExecutionBinding;
  readonly baseCanonicalInput: CanonicalOperatorInputV2;
  readonly baseCanonicalInputFingerprint: string;
  readonly seedCases: readonly DeclarativeFrozenSeedCaseBinding[];
}
export interface FrozenSeedEnvironmentDraws { readonly merchantWorldDraw: number; readonly customerPopulationDraw: number; readonly warmUpDraw: number; readonly environmentShockDraw: number; readonly operatorRandomnessDraw: number; }
export interface FrozenSeedEnvironmentArtifact { readonly kind: "baseline_validation_seed_environment"; readonly schemaVersion: "1.0.0"; readonly seedSetVersion: string; readonly seedSetFingerprint: string; readonly seedCaseId: string; readonly worldProfile: BaselineValidationWorldProfile; readonly seedBindingFingerprint: string; readonly draws: FrozenSeedEnvironmentDraws; readonly environmentFingerprint: string; }
export interface DeclarativeIsolationPair {
  readonly pairId: string;
  readonly canonicalInput: CanonicalOperatorInputV2;
  readonly canonicalInputFingerprint: string;
  readonly baselineWitness: object;
  readonly baselineWitnessFingerprint: string;
  readonly variantWitness: object;
  readonly variantWitnessFingerprint: string;
}
export interface DeclarativeIsolationEvidence {
  readonly operatorBinding: ValidationOperatorExecutionBinding;
  readonly primaryInputFingerprint: string;
  readonly pairs: readonly DeclarativeIsolationPair[];
}

const OPERATOR_BINDING_KEYS = ["operatorId", "operatorVersion", "implementationFingerprint", "configurationFingerprint", "adapterFingerprint"] as const;
const REPEATED_KEYS = ["operatorBinding", "canonicalInput", "canonicalInputFingerprint"] as const;
const SEED_EXECUTION_KEYS = ["operatorBinding", "baseCanonicalInput", "baseCanonicalInputFingerprint", "seedCases"] as const;
const SEED_CASE_KEYS = ["seedSetVersion", "seedSetFingerprint", "seedCaseId", "worldProfile", "seeds", "seedBindingFingerprint"] as const;
const ISOLATION_KEYS = ["operatorBinding", "primaryInputFingerprint", "pairs"] as const;
const ISOLATION_PAIR_KEYS = ["pairId", "canonicalInput", "canonicalInputFingerprint", "baselineWitness", "baselineWitnessFingerprint", "variantWitness", "variantWitnessFingerprint"] as const;

function bindings(input: CanonicalOperatorInputV2) {
  return { opportunityId: input.opportunityId, decisionTime: input.decisionTime, decisionContext: input.decisionContext, observationRecords: input.observation.records, legalActionSpace: input.legalActionSpace, constraints: input.constraints, evaluationContractFingerprint: input.provenance.evaluationContractFingerprint, evaluationContractVersion: input.provenance.evaluationContractVersion, observationFingerprint: input.provenance.observationFingerprint, legalActionSpaceFingerprint: input.provenance.legalActionSpaceFingerprint, actionOntologyVersion: input.provenance.actionOntologyVersion };
}

function exactOperatorBinding(operator: CanonicalOperatorV2, value: unknown): value is ValidationOperatorExecutionBinding {
  if (!isRecord(value) || !hasExactKeys(value, OPERATOR_BINDING_KEYS)) return false;
  const metadata = operator.metadata;
  return value["operatorId"] === metadata.operatorId && value["operatorVersion"] === metadata.operatorVersion && value["implementationFingerprint"] === metadata.implementationFingerprint && value["configurationFingerprint"] === metadata.configurationFingerprint && value["adapterFingerprint"] === metadata.adapterFingerprint;
}

function validatedInput(operator: CanonicalOperatorV2, value: unknown, fingerprint: unknown): CanonicalOperatorInputV2 {
  if (!isRecord(value) || !isFingerprint(fingerprint)) throw new TypeError("canonical input declaration is malformed");
  const input = assertCanonicalOperatorInputV2(value, bindings(value as unknown as CanonicalOperatorInputV2));
  if (canonicalInputFingerprint(input) !== fingerprint || input.provenance.observationFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, decisionTime: input.decisionTime, records: input.observation.records }) || input.provenance.legalActionSpaceFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, rules: input.legalActionSpace.rules, mutualExclusionGroups: input.legalActionSpace.mutualExclusionGroups }) || input.provenance.evaluationContractFingerprint !== operator.metadata.supportedEvaluationContract.contractFingerprint || input.provenance.evaluationContractVersion !== operator.metadata.supportedEvaluationContract.contractVersion || input.provenance.actionOntologyVersion !== operator.metadata.supportedActionOntologyVersion) throw new TypeError("canonical input declaration is not independently bound");
  return input;
}

export function runDeclarativeRepeatedExecution(operator: CanonicalOperatorV2, value: unknown, checkId: "determinism" | "uncontrolled_randomness_detection"): BaselineValidationCheckResult {
  if (!isRecord(value) || !hasExactKeys(value, REPEATED_KEYS) || !isStrictJson(value) || !exactOperatorBinding(operator, value["operatorBinding"])) return result(checkId, [issue("INVALID_DECLARATIVE_EXECUTION_EVIDENCE", "evidence", "execution evidence must contain only an exact operator binding and canonical input")], []);
  try {
    const input = validatedInput(operator, value["canonicalInput"], value["canonicalInputFingerprint"]);
    const samples: DeterministicDecisionSample[] = [];
    const repetitions = checkId === "determinism" ? DETERMINISM_REPETITIONS : RANDOMNESS_PROBES;
    for (let index = 0; index < repetitions; index += 1) {
      const decisionEnvelope = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      samples.push({ sampleId: `harness-${checkId}-${index + 1}`, canonicalInputFingerprint: canonicalInputFingerprint(input), operatorFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, seedBindingFingerprint: evaluationFingerprint({ kind: "unseeded-primary-input" }), actions: decisionEnvelope.actions, decisionEnvelope });
    }
    return checkId === "determinism" ? validateDeterministicDecisions(samples) : detectUncontrolledRandomness(samples);
  } catch { return result(checkId, [issue("OPERATOR_INVOCATION_FAILED", "evidence", "harness-owned operator invocation or canonical validation failed")], []); }
}

export function runDeclarativeSeedExecution(operator: CanonicalOperatorV2, value: unknown): BaselineValidationCheckResult {
  if (!isRecord(value) || !hasExactKeys(value, SEED_EXECUTION_KEYS) || !exactOperatorBinding(operator, value["operatorBinding"]) || !Array.isArray(value["seedCases"]) || value["seedCases"].length !== 2 || !isStrictJson(value)) return result("seed_reproducibility", [issue("INVALID_DECLARATIVE_SEED_EVIDENCE", "evidence", "seed execution evidence must declare exactly two distinct frozen cases")], []);
  try {
    const base = validatedInput(operator, value["baseCanonicalInput"], value["baseCanonicalInputFingerprint"]);
    const samples: SeedReproducibilitySample[] = [];
    const frozenCases = value["seedCases"].map((raw) => {
      if (!isRecord(raw) || !hasExactKeys(raw, SEED_CASE_KEYS)) throw new TypeError("seed case declaration has unexpected keys");
      const frozen = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.find((candidate) => candidate.caseId === raw["seedCaseId"]);
      if (frozen === undefined || raw["seedSetVersion"] !== FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion || raw["seedSetFingerprint"] !== FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint || stableEvaluationJson(raw["worldProfile"]) !== stableEvaluationJson(frozen.worldProfile) || stableEvaluationJson(raw["seeds"]) !== stableEvaluationJson(frozen.seeds) || raw["seedBindingFingerprint"] !== evaluationFingerprint({ seedCaseId: frozen.caseId, seeds: frozen.seeds })) throw new TypeError("seed case is not an exact frozen binding");
      return frozen;
    });
    if (new Set(frozenCases.map((seedCase) => seedCase.caseId)).size !== frozenCases.length) throw new TypeError("seed cases must be distinct");
    for (const [caseIndex, frozen] of frozenCases.entries()) {
      const environment = materializeFrozenSeedEnvironment(frozen);
      const inputFingerprint = canonicalInputFingerprint(base);
      for (let runIndex = 0; runIndex < SEED_REPETITIONS; runIndex += 1) {
        const decision = validateCanonicalDecisionEnvelope(base, operator.metadata, operator.decide(base));
        samples.push({ sampleId: `harness-seed-${caseIndex + 1}-${runIndex + 1}`, seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: frozen.caseId, seeds: frozen.seeds, seedBindingFingerprint: evaluationFingerprint({ seedCaseId: frozen.caseId, seeds: frozen.seeds }), environmentFingerprint: environment.environmentFingerprint, canonicalInputFingerprint: inputFingerprint, operatorFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, runFingerprint: evaluationFingerprint({ environmentFingerprint: environment.environmentFingerprint, canonicalInputFingerprint: inputFingerprint, decisionFingerprint: canonicalOperatorDecisionFingerprint(decision) }) });
      }
    }
    return validateSeedReproducibility(samples);
  } catch { return result("seed_reproducibility", [issue("INVALID_DECLARATIVE_SEED_EVIDENCE", "evidence", "seed materialization, binding, or operator invocation failed")], []); }
}

export function runDeclarativeIsolationExecution(operator: CanonicalOperatorV2, value: unknown, checkId: "hidden_truth_isolation" | "future_information_isolation"): BaselineValidationCheckResult {
  if (!isRecord(value) || !hasExactKeys(value, ISOLATION_KEYS) || !isStrictJson(value) || !exactOperatorBinding(operator, value["operatorBinding"]) || !isFingerprint(value["primaryInputFingerprint"]) || !Array.isArray(value["pairs"]) || value["pairs"].length === 0) return result(checkId, [issue("INVALID_DECLARATIVE_ISOLATION_EVIDENCE", "evidence", "isolation evidence must declare only bound inputs and strict evaluator-owned witnesses")], []);
  try {
    const generated: InformationIsolationPair[] = value["pairs"].map((raw, index) => {
      if (!isRecord(raw) || !hasExactKeys(raw, ISOLATION_PAIR_KEYS) || typeof raw["pairId"] !== "string" || raw["pairId"].length === 0 || !isRecord(raw["baselineWitness"]) || !isRecord(raw["variantWitness"]) || !isStrictJson(raw["baselineWitness"]) || !isStrictJson(raw["variantWitness"]) || raw["baselineWitnessFingerprint"] !== evaluationFingerprint(raw["baselineWitness"]) || raw["variantWitnessFingerprint"] !== evaluationFingerprint(raw["variantWitness"]) || raw["baselineWitnessFingerprint"] === raw["variantWitnessFingerprint"]) throw new TypeError(`invalid isolation pair ${index}`);
      const input = validatedInput(operator, raw["canonicalInput"], raw["canonicalInputFingerprint"]);
      if (raw["canonicalInputFingerprint"] !== value["primaryInputFingerprint"]) throw new TypeError("isolation input differs from primary input");
      const baselineDecision = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      const variantDecision = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      return { pairId: raw["pairId"], baseline: { visibleInputFingerprint: raw["canonicalInputFingerprint"], witness: raw["baselineWitness"], witnessFingerprint: raw["baselineWitnessFingerprint"], decisionFingerprint: canonicalPolicyDecisionFingerprint(baselineDecision.actions), actions: baselineDecision.actions }, variant: { visibleInputFingerprint: raw["canonicalInputFingerprint"], witness: raw["variantWitness"], witnessFingerprint: raw["variantWitnessFingerprint"], decisionFingerprint: canonicalPolicyDecisionFingerprint(variantDecision.actions), actions: variantDecision.actions } } as InformationIsolationPair;
    });
    return checkId === "hidden_truth_isolation" ? validateHiddenTruthIsolation(generated) : validateFutureInformationIsolation(generated);
  } catch { return result(checkId, [issue("INVALID_DECLARATIVE_ISOLATION_EVIDENCE", "evidence", "isolation input, witness, or harness-owned invocation failed validation")], []); }
}

/** One fixed 32-bit avalanche step. Each namespace is salted independently; no ambient PRNG state participates. */
function deterministicDraw(seed: number, salt: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
}

export function deriveSeedEnvironmentDraws(seeds: BaselineValidationSeeds): FrozenSeedEnvironmentDraws {
  return deepFreezeEvaluation({ merchantWorldDraw: deterministicDraw(seeds.merchant_generation, 0x9e3779b9), customerPopulationDraw: deterministicDraw(seeds.customer_population, 0x243f6a88), warmUpDraw: deterministicDraw(seeds.baseline_warm_up, 0xb7e15162), environmentShockDraw: deterministicDraw(seeds.shared_evaluation_environment, 0x8aed2a6b), operatorRandomnessDraw: deterministicDraw(seeds.operator_randomness, 0xc6ef3720) });
}

export function materializeFrozenSeedEnvironment(seedCase: BaselineValidationSeedCase): FrozenSeedEnvironmentArtifact {
  const frozen = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.find((candidate) => candidate.caseId === seedCase.caseId);
  if (frozen === undefined || stableEvaluationJson(seedCase) !== stableEvaluationJson(frozen)) throw new BaselineValidationError("seed execution must bind an exact frozen seed case");
  const seedBindingFingerprint = evaluationFingerprint({ seedCaseId: frozen.caseId, seeds: frozen.seeds });
  const body = { kind: "baseline_validation_seed_environment" as const, schemaVersion: "1.0.0" as const, seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: frozen.caseId, worldProfile: frozen.worldProfile, seedBindingFingerprint, draws: deriveSeedEnvironmentDraws(frozen.seeds) };
  return deepFreezeEvaluation({ ...body, environmentFingerprint: evaluationFingerprint(body) });
}
