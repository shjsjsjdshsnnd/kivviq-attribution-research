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
} from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", 0);

function input() {
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  return buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
}

const replayProvenance = {
  constraintFingerprint: operatorFingerprint({ constraints: "step3.1" }),
  schemaFingerprint: canonicalReplaySchemaFingerprint(),
  seedBinding: { operatorInternal: 7 },
  seedFingerprint: operatorFingerprint({ seed: 7 }),
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
    seedFingerprint: operatorFingerprint(replayProvenance.seedBinding),
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
    ["seed binding", (x: any) => { x.provenance.seedBinding = { operatorInternal: 8 }; }],
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
