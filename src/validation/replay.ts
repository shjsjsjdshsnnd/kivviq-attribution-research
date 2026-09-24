import { actionFingerprint } from "../action_ontology/semantics.js";
import { serializeAction } from "../action_ontology/serialization.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { deepFreezeEvaluation, evaluationFingerprint, stableEvaluationJson } from "../evaluation/baseline-contract.js";
import {
  CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
  CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION,
  CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION,
  assertCanonicalOperatorInputV2,
  assertCanonicalOperatorMetadataV2,
  canonicalInputFingerprint,
  canonicalOperatorDecisionFingerprint,
  ensureCanonicalOperatorV2,
  validateCanonicalDecisionEnvelope,
  type CanonicalOperatorDecisionV2,
  type CanonicalOperatorInputV2,
  type CanonicalOperatorMetadataV2,
  type CanonicalOperatorV2,
} from "../operator/canonical-interface.js";
import type { CanonicalOperator } from "../operator/types.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import { hasExactKeys, isFingerprint, isRecord, isStrictJson, issue, result, safeFingerprint } from "./shared.js";

export const RECORDED_DECISION_ARTIFACT_SCHEMA_VERSION = "1.0.0" as const;

export interface ReplayProvenanceInput {
  readonly constraintFingerprint: string;
  readonly schemaFingerprint: string;
  readonly seedBinding: unknown;
  readonly seedFingerprint: string;
}

export interface RecordedDecisionProvenance extends ReplayProvenanceInput {
  readonly evaluationFingerprint: string;
  readonly observationFingerprint: string;
  readonly legalActionSpaceFingerprint: string;
  readonly canonicalInputFingerprint: string;
}

export interface RecordedDecisionArtifactBody {
  readonly kind: "canonical_operator_decision_recording";
  readonly schemaVersion: typeof RECORDED_DECISION_ARTIFACT_SCHEMA_VERSION;
  readonly operatorMetadata: CanonicalOperatorMetadataV2;
  readonly canonicalInput: CanonicalOperatorInputV2;
  readonly decisionTimestamp: string;
  readonly provenance: RecordedDecisionProvenance;
  readonly canonicalDecision: CanonicalOperatorDecisionV2;
  readonly canonicalActionJson: readonly string[];
  readonly actionFingerprints: readonly string[];
  readonly decisionFingerprint: string;
}

export interface RecordedDecisionArtifact extends RecordedDecisionArtifactBody {
  readonly artifactFingerprint: string;
}

const ARTIFACT_KEYS = ["kind", "schemaVersion", "operatorMetadata", "canonicalInput", "decisionTimestamp", "provenance", "canonicalDecision", "canonicalActionJson", "actionFingerprints", "decisionFingerprint", "artifactFingerprint"] as const;
const PROVENANCE_KEYS = ["evaluationFingerprint", "observationFingerprint", "legalActionSpaceFingerprint", "constraintFingerprint", "schemaFingerprint", "seedBinding", "seedFingerprint", "canonicalInputFingerprint"] as const;

function cloneFreeze<T>(value: T): T {
  return deepFreezeEvaluation(JSON.parse(stableEvaluationJson(value)) as T);
}

function bodyFingerprint(value: RecordedDecisionArtifactBody | RecordedDecisionArtifact): string {
  const { artifactFingerprint: _omitted, ...body } = value as RecordedDecisionArtifact & Record<string, unknown>;
  return evaluationFingerprint(body);
}

function inputBindings(input: CanonicalOperatorInputV2) {
  return {
    opportunityId: input.opportunityId,
    decisionTime: input.decisionTime,
    decisionContext: input.decisionContext,
    observationRecords: input.observation.records,
    legalActionSpace: input.legalActionSpace,
    constraints: input.constraints,
    evaluationContractFingerprint: input.provenance.evaluationContractFingerprint,
    evaluationContractVersion: input.provenance.evaluationContractVersion,
    observationFingerprint: input.provenance.observationFingerprint,
    legalActionSpaceFingerprint: input.provenance.legalActionSpaceFingerprint,
    actionOntologyVersion: input.provenance.actionOntologyVersion,
  };
}

function expectedObservationFingerprint(input: CanonicalOperatorInputV2): string {
  return evaluationFingerprint({ opportunityId: input.opportunityId, decisionTime: input.decisionTime, records: input.observation.records });
}

function expectedActionSpaceFingerprint(input: CanonicalOperatorInputV2): string {
  return evaluationFingerprint({ opportunityId: input.opportunityId, rules: input.legalActionSpace.rules, mutualExclusionGroups: input.legalActionSpace.mutualExclusionGroups });
}

function expectedActionJson(decision: CanonicalOperatorDecisionV2): readonly string[] {
  return decision.actions.map((action) => serializeAction(assertValidAction(action)));
}

function expectedActionFingerprints(decision: CanonicalOperatorDecisionV2): readonly string[] {
  return decision.actions.map((action) => actionFingerprint(assertValidAction(action)));
}

export function recordedDecisionArtifactFingerprint(value: RecordedDecisionArtifactBody | RecordedDecisionArtifact): string {
  return bodyFingerprint(value);
}

export function canonicalReplaySchemaFingerprint(): string {
  return evaluationFingerprint({
    artifactSchemaVersion: RECORDED_DECISION_ARTIFACT_SCHEMA_VERSION,
    inputSchemaVersion: CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION,
    decisionSchemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
    metadataSchemaVersion: CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION,
  });
}

export function createRecordedDecisionArtifact(
  operator: CanonicalOperator | CanonicalOperatorV2,
  input: CanonicalOperatorInputV2,
  decision: CanonicalOperatorDecisionV2,
  provenance: ReplayProvenanceInput,
): RecordedDecisionArtifact {
  const canonical = ensureCanonicalOperatorV2(operator);
  assertCanonicalOperatorMetadataV2(canonical.metadata);
  const validatedInput = assertCanonicalOperatorInputV2(input, inputBindings(input));
  const validatedDecision = validateCanonicalDecisionEnvelope(validatedInput, canonical.metadata, decision);
  if (!isFingerprint(provenance.constraintFingerprint) || provenance.constraintFingerprint !== evaluationFingerprint(validatedInput.constraints)) throw new TypeError("replay constraint fingerprint does not match canonical input");
  if (!isFingerprint(provenance.schemaFingerprint) || provenance.schemaFingerprint !== canonicalReplaySchemaFingerprint()) throw new TypeError("replay schema fingerprint does not match canonical schemas");
  if (!isStrictJson(provenance.seedBinding) || !isFingerprint(provenance.seedFingerprint) || provenance.seedFingerprint !== evaluationFingerprint(provenance.seedBinding)) throw new TypeError("replay seed fingerprint does not match strict deterministic seed binding");
  const body: RecordedDecisionArtifactBody = {
    kind: "canonical_operator_decision_recording",
    schemaVersion: RECORDED_DECISION_ARTIFACT_SCHEMA_VERSION,
    operatorMetadata: canonical.metadata,
    canonicalInput: validatedInput,
    decisionTimestamp: validatedInput.decisionTime,
    provenance: {
      evaluationFingerprint: validatedInput.provenance.evaluationContractFingerprint,
      observationFingerprint: validatedInput.provenance.observationFingerprint,
      legalActionSpaceFingerprint: validatedInput.provenance.legalActionSpaceFingerprint,
      ...provenance,
      canonicalInputFingerprint: canonicalInputFingerprint(validatedInput),
    },
    canonicalDecision: validatedDecision,
    canonicalActionJson: expectedActionJson(validatedDecision),
    actionFingerprints: expectedActionFingerprints(validatedDecision),
    decisionFingerprint: canonicalOperatorDecisionFingerprint(validatedDecision),
  };
  return cloneFreeze({ ...body, artifactFingerprint: bodyFingerprint(body) });
}

function validateShape(value: unknown): value is RecordedDecisionArtifact {
  return isRecord(value) && hasExactKeys(value, ARTIFACT_KEYS) &&
    isRecord(value["provenance"]) && hasExactKeys(value["provenance"], PROVENANCE_KEYS) && isStrictJson(value);
}

function checkArtifact(value: unknown): { artifact?: RecordedDecisionArtifact; issues: BaselineValidationIssue[] } {
  const issues: BaselineValidationIssue[] = [];
  if (!validateShape(value)) {
    return { issues: [issue("INVALID_REPLAY_ARTIFACT", "evidence", "recorded decision artifact must be exact-key strict deterministic JSON")] };
  }
  const artifact = value;
  if (artifact.kind !== "canonical_operator_decision_recording" || artifact.schemaVersion !== RECORDED_DECISION_ARTIFACT_SCHEMA_VERSION) {
    issues.push(issue("INVALID_REPLAY_ARTIFACT", "evidence.schemaVersion", "recorded decision artifact kind or schema version is unsupported"));
  }
  try { assertCanonicalOperatorMetadataV2(artifact.operatorMetadata); } catch (error) {
    issues.push(issue("REPLAY_OPERATOR_METADATA_INVALID", "evidence.operatorMetadata", error instanceof Error ? error.message : String(error)));
  }
  try { assertCanonicalOperatorInputV2(artifact.canonicalInput, inputBindings(artifact.canonicalInput)); } catch (error) {
    issues.push(issue("REPLAY_INPUT_INVALID", "evidence.canonicalInput", error instanceof Error ? error.message : String(error)));
  }
  if (artifact.decisionTimestamp !== artifact.canonicalInput.decisionTime) {
    issues.push(issue("REPLAY_TIMESTAMP_MISMATCH", "evidence.decisionTimestamp", "recorded decision timestamp differs from canonical input"));
  }
  const p = artifact.provenance;
  for (const key of PROVENANCE_KEYS.filter((entry) => entry !== "seedBinding")) {
    if (!isFingerprint(p[key])) issues.push(issue("REPLAY_PROVENANCE_INVALID", `evidence.provenance.${key}`, "replay provenance field must be a canonical fingerprint"));
  }
  if (p.evaluationFingerprint !== artifact.canonicalInput.provenance.evaluationContractFingerprint) issues.push(issue("REPLAY_EVALUATION_PROVENANCE_MISMATCH", "evidence.provenance.evaluationFingerprint", "evaluation provenance differs from canonical input"));
  if (p.observationFingerprint !== expectedObservationFingerprint(artifact.canonicalInput) || p.observationFingerprint !== artifact.canonicalInput.provenance.observationFingerprint) issues.push(issue("REPLAY_OBSERVATION_PROVENANCE_MISMATCH", "evidence.provenance.observationFingerprint", "observation provenance could not be recomputed"));
  if (p.legalActionSpaceFingerprint !== expectedActionSpaceFingerprint(artifact.canonicalInput) || p.legalActionSpaceFingerprint !== artifact.canonicalInput.provenance.legalActionSpaceFingerprint) issues.push(issue("REPLAY_ACTION_SPACE_PROVENANCE_MISMATCH", "evidence.provenance.legalActionSpaceFingerprint", "Action-space provenance could not be recomputed"));
  if (p.constraintFingerprint !== evaluationFingerprint(artifact.canonicalInput.constraints)) issues.push(issue("REPLAY_CONSTRAINT_PROVENANCE_MISMATCH", "evidence.provenance.constraintFingerprint", "constraint provenance could not be recomputed"));
  if (p.schemaFingerprint !== canonicalReplaySchemaFingerprint()) issues.push(issue("REPLAY_SCHEMA_PROVENANCE_MISMATCH", "evidence.provenance.schemaFingerprint", "schema provenance could not be recomputed"));
  if (!isStrictJson(p.seedBinding) || p.seedFingerprint !== evaluationFingerprint(p.seedBinding)) issues.push(issue("REPLAY_SEED_PROVENANCE_MISMATCH", "evidence.provenance.seedFingerprint", "seed provenance could not be recomputed"));
  if (p.canonicalInputFingerprint !== canonicalInputFingerprint(artifact.canonicalInput)) issues.push(issue("REPLAY_INPUT_FINGERPRINT_MISMATCH", "evidence.provenance.canonicalInputFingerprint", "canonical input fingerprint could not be recomputed"));
  try {
    const decision = validateCanonicalDecisionEnvelope(artifact.canonicalInput, artifact.operatorMetadata, artifact.canonicalDecision);
    if (stableEvaluationJson(artifact.canonicalActionJson) !== stableEvaluationJson(expectedActionJson(decision)) || stableEvaluationJson(artifact.actionFingerprints) !== stableEvaluationJson(expectedActionFingerprints(decision))) issues.push(issue("REPLAY_ACTION_RECORD_MISMATCH", "evidence.canonicalActionJson", "recorded canonical Action serialization or semantic fingerprints differ"));
    if (artifact.decisionFingerprint !== canonicalOperatorDecisionFingerprint(decision)) issues.push(issue("REPLAY_DECISION_FINGERPRINT_MISMATCH", "evidence.decisionFingerprint", "recorded decision fingerprint could not be recomputed"));
  } catch (error) {
    issues.push(issue("REPLAY_DECISION_INVALID", "evidence.canonicalDecision", error instanceof Error ? error.message : String(error)));
  }
  if (!isFingerprint(artifact.artifactFingerprint) || artifact.artifactFingerprint !== bodyFingerprint(artifact)) issues.push(issue("REPLAY_ARTIFACT_FINGERPRINT_MISMATCH", "evidence.artifactFingerprint", "artifact fingerprint could not be recomputed"));
  return { artifact, issues };
}

export function validateRecordedDecisionArtifact(value: unknown): BaselineValidationCheckResult {
  const checked = checkArtifact(value);
  return result("artifact_replay", checked.issues, checked.artifact === undefined ? [] : [checked.artifact.artifactFingerprint].filter(isFingerprint));
}

export function replayRecordedDecision(operator: CanonicalOperator | CanonicalOperatorV2, value: unknown): BaselineValidationCheckResult {
  const checked = checkArtifact(value);
  if (checked.artifact === undefined) return result("artifact_replay", checked.issues, []);
  const artifact = checked.artifact;
  const issues = [...checked.issues];
  let canonical: CanonicalOperatorV2 | undefined;
  try { canonical = ensureCanonicalOperatorV2(operator); } catch (error) {
    issues.push(issue("REPLAY_OPERATOR_INVALID", "operator", error instanceof Error ? error.message : String(error)));
  }
  if (canonical !== undefined && stableEvaluationJson(canonical.metadata) !== stableEvaluationJson(artifact.operatorMetadata)) {
    issues.push(issue("REPLAY_OPERATOR_IDENTITY_MISMATCH", "operator.metadata", "operator identity, version, configuration, implementation, or adapter differs from recording"));
  }
  if (canonical !== undefined && issues.every((entry) => !entry.code.startsWith("REPLAY_OPERATOR_") && !entry.code.startsWith("REPLAY_INPUT_"))) {
    try {
      const replayed = validateCanonicalDecisionEnvelope(artifact.canonicalInput, canonical.metadata, canonical.decide(cloneFreeze(artifact.canonicalInput)));
      if (stableEvaluationJson(expectedActionJson(replayed)) !== stableEvaluationJson(artifact.canonicalActionJson) || canonicalOperatorDecisionFingerprint(replayed) !== artifact.decisionFingerprint) {
        issues.push(issue("REPLAY_DECISION_MISMATCH", "evidence.canonicalDecision", "replayed Actions or decision fingerprint differ from the recording"));
      }
    } catch (error) {
      issues.push(issue("REPLAY_INVOCATION_FAILED", "operator.decide", error instanceof Error ? error.message : String(error)));
    }
  }
  const fingerprint = safeFingerprint(value);
  return result("artifact_replay", issues, fingerprint === undefined ? [] : [fingerprint]);
}
