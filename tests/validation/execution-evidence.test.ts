import { describe, expect, it } from "vitest";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { canonicalInputFingerprint, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { FROZEN_BASELINE_VALIDATION_SEED_SET, materializeSeedBoundCanonicalInput, runDeclarativeSeedExecution } from "../../src/validation/index.js";

function baseInput() {
  const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
  const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", 0);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  return buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
}

describe("evaluator-owned execution evidence", () => {
  it("materializes exact frozen seeds into reproducible distinct canonical inputs", () => {
    const base = baseInput();
    const firstSeed = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!;
    const secondSeed = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[1]!;
    const firstA = materializeSeedBoundCanonicalInput(base, firstSeed);
    const firstB = materializeSeedBoundCanonicalInput(base, firstSeed);
    const second = materializeSeedBoundCanonicalInput(base, secondSeed);
    expect(canonicalInputFingerprint(firstA)).toBe(canonicalInputFingerprint(firstB));
    expect(canonicalInputFingerprint(firstA)).not.toBe(canonicalInputFingerprint(second));
    expect(firstA.observation.records.at(-1)?.value).toMatchObject({ seeds: firstSeed.seeds });
    const operator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    expect(operator.decide(firstA).actions).toEqual([]);
    expect(operator.decide(second).actions).toEqual([]);
  });

  it("rejects arbitrary seed labels", () => {
    expect(() => materializeSeedBoundCanonicalInput(baseInput(), { ...FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!, caseId: "arbitrary" })).toThrow();
  });

  it("records identical runs within a seed and distinct bound runs across seeds", () => {
    const operator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    const input = baseInput();
    const binding = { operatorId: operator.metadata.operatorId, operatorVersion: operator.metadata.operatorVersion, implementationFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, adapterFingerprint: operator.metadata.adapterFingerprint };
    const seedBinding = (index: number) => {
      const seedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[index]!;
      return { seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: seedCase.caseId, worldProfile: seedCase.worldProfile, seeds: seedCase.seeds, seedBindingFingerprint: evaluationFingerprint({ seedCaseId: seedCase.caseId, seeds: seedCase.seeds }) };
    };
    const result = runDeclarativeSeedExecution(operator, { operatorBinding: binding, baseCanonicalInput: input, baseCanonicalInputFingerprint: canonicalInputFingerprint(input), seedCases: [seedBinding(0), seedBinding(1)], repetitionsPerSeed: 2 });
    expect(result.status).toBe("PASS");
    expect(result.evidenceFingerprints).toHaveLength(4);
    expect(new Set(result.evidenceFingerprints).size).toBe(2);
  });
});
