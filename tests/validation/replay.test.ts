import { describe, expect, it } from "vitest";
import { googleBudgetUp2000 } from "../../src/action_translation/fixtures.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import {
  CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
  CANONICAL_OPERATOR_INTERFACE_VERSION,
  ensureCanonicalOperatorV2,
  type CanonicalOperatorV2,
} from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { operatorFingerprint } from "../../src/operator/identity.js";
import {
  createRecordedDecisionArtifact,
  canonicalReplaySchemaFingerprint,
  replayRecordedDecision,
  validateRecordedDecisionArtifact,
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  recordedDecisionArtifactFingerprint,
} from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", 0);

function input() {
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  return buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
}

const frozenSeedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!;
const replayProvenance = {
  constraintFingerprint: operatorFingerprint({ constraints: "step3.1" }),
  schemaFingerprint: canonicalReplaySchemaFingerprint(),
  seedCaseId: frozenSeedCase.caseId,
  seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion,
  seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
  seeds: frozenSeedCase.seeds,
  seedFingerprint: operatorFingerprint(frozenSeedCase.seeds),
};

function actionOperator(): CanonicalOperatorV2 {
  const base = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
  const metadata = {
    ...base.metadata,
    operatorId: "test.action-capable",
    operatorFamily: "advanced_decision_system" as const,
    implementationFingerprint: operatorFingerprint({ implementation: "action-capable" }),
    configurationFingerprint: operatorFingerprint({ configuration: "action-capable" }),
    capabilities: { ...base.metadata.capabilities, actionDomains: ["advertising" as const], maximumActionsPerDecision: 1 },
    adapterFingerprint: operatorFingerprint({ adapter: "native-v2-action-capable" }),
    legacyInterfaceVersion: null,
  };
  return {
    metadata,
    decide(value) {
      return {
        schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
        actions: [googleBudgetUp2000],
        operatorMetadata: metadata,
        decisionMetadata: {
          interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
          decisionTimestamp: value.decisionTime,
          deterministicReplayExpected: true,
          randomness: { kind: "deterministic" },
          canonicalActionOrdering: "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC",
        },
      };
    },
  };
}

function artifact(operator: CanonicalOperatorV2 = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR)) {
  const canonicalInput = input();
  return createRecordedDecisionArtifact(operator, canonicalInput, operator.decide(canonicalInput), {
    ...replayProvenance,
    constraintFingerprint: operatorFingerprint(canonicalInput.constraints),
  });
}

describe("recorded canonical decision replay", () => {
  it("replays immutable DO_NOTHING and action-capable artifacts", () => {
    for (const operator of [ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR), actionOperator()]) {
      const recorded = artifact(operator);
      expect(validateRecordedDecisionArtifact(recorded).status).toBe("PASS");
      expect(replayRecordedDecision(operator, recorded)).toMatchObject({ checkId: "artifact_replay", status: "PASS", issues: [] });
      expect(Object.isFrozen(recorded)).toBe(true);
      expect(Object.isFrozen(replayRecordedDecision(operator, recorded))).toBe(true);
    }
  });

  it.each([
    ["observation", (x: any) => { x.canonicalInput.observation.records.push({}); }],
    ["timestamp", (x: any) => { x.canonicalInput.decisionTime = "2026-10-02T00:00:00.000Z"; }],
    ["action space", (x: any) => { x.canonicalInput.legalActionSpace.rules.push({}); }],
    ["constraints", (x: any) => { x.canonicalInput.constraints.dimensions.push("tampered"); }],
    ["seed", (x: any) => { x.provenance.seedFingerprint = operatorFingerprint({ seed: 8 }); }],
    ["seed binding", (x: any) => { x.provenance.seeds.operator_randomness += 1; }],
    ["schema", (x: any) => { x.provenance.schemaFingerprint = operatorFingerprint({ schema: "other" }); }],
    ["configuration", (x: any) => { x.operatorMetadata.configurationFingerprint = operatorFingerprint({ changed: true }); }],
    ["implementation", (x: any) => { x.operatorMetadata.implementationFingerprint = operatorFingerprint({ changed: true }); }],
    ["output", (x: any) => { x.canonicalDecision.actions = []; }],
  ])("fails deterministically when %s is tampered", (_label, mutate) => {
    const operator = actionOperator();
    const changed: any = structuredClone(artifact(operator));
    mutate(changed);
    const first = replayRecordedDecision(operator, changed);
    const second = replayRecordedDecision(operator, changed);
    expect(first.status).toBe("FAIL");
    expect(first.issues.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });

  it("rejects arbitrary recomputed seeds and unknown frozen seed cases", () => {
    const operator = actionOperator();
    const arbitrary: any = structuredClone(artifact(operator));
    arbitrary.provenance.seeds.operator_randomness += 1;
    arbitrary.provenance.seedFingerprint = operatorFingerprint(arbitrary.provenance.seeds);
    arbitrary.artifactFingerprint = operatorFingerprint(Object.fromEntries(Object.entries(arbitrary).filter(([key]) => key !== "artifactFingerprint")));
    expect(replayRecordedDecision(operator, arbitrary).issues.map((x) => x.code)).toContain("REPLAY_SEED_PROVENANCE_MISMATCH");

    const wrongCase: any = structuredClone(artifact(operator));
    wrongCase.provenance.seedCaseId = "not-a-frozen-case";
    expect(replayRecordedDecision(operator, wrongCase).issues.map((x) => x.code)).toContain("REPLAY_SEED_CASE_UNKNOWN");
  });

  it.each([
    ["adapter", "REPLAY_OPERATOR_IDENTITY_MISMATCH", (x: any) => { x.operatorMetadata.adapterFingerprint = operatorFingerprint({ adapter: "changed" }); }],
    ["operator ID", "REPLAY_OPERATOR_IDENTITY_MISMATCH", (x: any) => { x.operatorMetadata.operatorId = "test.changed"; }],
    ["operator version", "REPLAY_OPERATOR_IDENTITY_MISMATCH", (x: any) => { x.operatorMetadata.operatorVersion = "9.0.0"; }],
    ["configuration", "REPLAY_OPERATOR_IDENTITY_MISMATCH", (x: any) => { x.operatorMetadata.configurationFingerprint = operatorFingerprint({ configuration: "changed" }); }],
    ["implementation", "REPLAY_OPERATOR_IDENTITY_MISMATCH", (x: any) => { x.operatorMetadata.implementationFingerprint = operatorFingerprint({ implementation: "changed" }); }],
    ["evaluation provenance", "REPLAY_EVALUATION_PROVENANCE_MISMATCH", (x: any) => { x.provenance.evaluationFingerprint = operatorFingerprint({ evaluation: "changed" }); }],
    ["input provenance", "REPLAY_INPUT_PROVENANCE_MISMATCH", (x: any) => { x.canonicalInput.provenance.evaluationContractVersion = "9.0.0"; }],
    ["input fingerprint", "REPLAY_INPUT_FINGERPRINT_MISMATCH", (x: any) => { x.provenance.canonicalInputFingerprint = operatorFingerprint({ input: "changed" }); }],
    ["observation", "REPLAY_OBSERVATION_PROVENANCE_MISMATCH", (x: any) => { x.canonicalInput.observation.records.push({}); }],
    ["action space", "REPLAY_ACTION_SPACE_PROVENANCE_MISMATCH", (x: any) => { x.canonicalInput.legalActionSpace.rules.push({}); }],
    ["constraints", "REPLAY_CONSTRAINT_PROVENANCE_MISMATCH", (x: any) => { x.canonicalInput.constraints.dimensions.push("changed"); }],
    ["schema", "REPLAY_SCHEMA_PROVENANCE_MISMATCH", (x: any) => { x.provenance.schemaFingerprint = operatorFingerprint({ schema: "changed" }); }],
    ["seed", "REPLAY_SEED_PROVENANCE_MISMATCH", (x: any) => { x.provenance.seeds.operator_randomness += 1; }],
    ["canonical Action JSON", "REPLAY_ACTION_RECORD_MISMATCH", (x: any) => { x.canonicalActionJson = []; }],
    ["Action fingerprints", "REPLAY_ACTION_RECORD_MISMATCH", (x: any) => { x.actionFingerprints = []; }],
    ["decision fingerprint", "REPLAY_DECISION_FINGERPRINT_MISMATCH", (x: any) => { x.decisionFingerprint = operatorFingerprint({ decision: "changed" }); }],
    ["artifact fingerprint", "REPLAY_ARTIFACT_FINGERPRINT_MISMATCH", (x: any) => { x.artifactFingerprint = operatorFingerprint({ artifact: "changed" }); }],
    ["timestamp", "REPLAY_TIMESTAMP_MISMATCH", (x: any) => { x.decisionTimestamp = "2026-10-02T00:00:00.000Z"; }],
    ["output", "REPLAY_DECISION_MISMATCH", (x: any) => {
      x.canonicalDecision.actions = [];
      x.canonicalActionJson = [];
      x.actionFingerprints = [];
      x.decisionFingerprint = operatorFingerprint(x.canonicalDecision);
      x.artifactFingerprint = recordedDecisionArtifactFingerprint(x);
    }],
  ])("reports the stable %s tamper code", (_label, expectedCode, mutate) => {
    const operator = actionOperator();
    const changed: any = structuredClone(artifact(operator));
    mutate(changed);
    expect(replayRecordedDecision(operator, changed).issues.map((x) => x.code)).toContain(expectedCode);
  });

  it("normalizes varying operator exceptions to byte-identical replay failures", () => {
    const base = actionOperator();
    const recorded = artifact(base);
    let calls = 0;
    const throwing: CanonicalOperatorV2 = { ...base, decide() { calls += 1; throw new Error(`ambient-${calls}-${Date.now()}`); } };
    expect(replayRecordedDecision(throwing, recorded)).toEqual(replayRecordedDecision(throwing, recorded));
  });

  it("fails closed for seeded operators until canonical inputs carry seed bindings", () => {
    const deterministic = actionOperator();
    const metadata = { ...deterministic.metadata, capabilities: { ...deterministic.metadata.capabilities, randomness: { kind: "seeded_stochastic" as const, seedNamespace: "operator_internal" as const, seedRequired: true as const } } };
    const seeded: CanonicalOperatorV2 = { metadata, decide(value) {
      const decision = deterministic.decide(value);
      return { ...decision, operatorMetadata: metadata, decisionMetadata: { ...decision.decisionMetadata, deterministicReplayExpected: false, randomness: metadata.capabilities.randomness } };
    } };
    expect(replayRecordedDecision(seeded, artifact(deterministic)).issues.map((x) => x.code)).toContain("REPLAY_SEEDED_OPERATOR_UNSUPPORTED");
  });

  it("rejects wrong operators, nondeterministic replay, and unknown fields", () => {
    expect(replayRecordedDecision(ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR), artifact(actionOperator())).issues.map((x) => x.code)).toContain("REPLAY_OPERATOR_IDENTITY_MISMATCH");

    const stable = actionOperator();
    let calls = 0;
    const nondeterministic: CanonicalOperatorV2 = { ...stable, decide(value) {
      calls += 1;
      const decision = stable.decide(value);
      return calls === 1 ? decision : { ...decision, actions: [] };
    } };
    const recorded = artifact(nondeterministic);
    expect(replayRecordedDecision(nondeterministic, recorded).issues.map((x) => x.code)).toContain("REPLAY_DECISION_MISMATCH");

    expect(replayRecordedDecision(stable, { ...artifact(stable), ambient: true } as never).issues.map((x) => x.code)).toContain("INVALID_REPLAY_ARTIFACT");
  });
});
