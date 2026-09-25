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
import { DETERMINISM_REPETITIONS, FROZEN_BASELINE_VALIDATION_SEED_SET, RANDOMNESS_PROBES, deriveSeedEnvironmentDraws, materializeFrozenSeedEnvironment, runDeclarativeRepeatedExecution, runDeclarativeSeedExecution } from "../../src/validation/index.js";

function baseInput() {
  const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
  const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", 0);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  return buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
}

describe("evaluator-owned execution evidence", () => {
  it("materializes exact frozen seeds into stable distinct evaluator-only environments", () => {
    const firstSeed = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!;
    const secondSeed = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[1]!;
    const firstA = materializeFrozenSeedEnvironment(firstSeed);
    const firstB = materializeFrozenSeedEnvironment(firstSeed);
    const second = materializeFrozenSeedEnvironment(secondSeed);
    expect(firstA).toEqual(firstB);
    expect(firstA.environmentFingerprint).not.toBe(second.environmentFingerprint);
  });

  it("rejects arbitrary seed labels", () => {
    expect(() => materializeFrozenSeedEnvironment({ ...FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!, caseId: "arbitrary" })).toThrow();
  });

  it("uses every frozen seed namespace in deterministic environment derivation", () => {
    const seeds = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!.seeds;
    const baseline = evaluationFingerprint(deriveSeedEnvironmentDraws(seeds));
    for (const namespace of Object.keys(seeds) as Array<keyof typeof seeds>) {
      expect(evaluationFingerprint(deriveSeedEnvironmentDraws({ ...seeds, [namespace]: seeds[namespace] + 1 })), namespace).not.toBe(baseline);
    }
  });

  it("summarizes identical runs as unique bound fingerprints across seeds", () => {
    const baseOperator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    const input = baseInput();
    const seenInputs: string[] = [];
    const operator = { ...baseOperator, decide(value: Parameters<typeof baseOperator.decide>[0]) { seenInputs.push(JSON.stringify(value)); return baseOperator.decide(value); } };
    const binding = { operatorId: operator.metadata.operatorId, operatorVersion: operator.metadata.operatorVersion, implementationFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, adapterFingerprint: operator.metadata.adapterFingerprint };
    const seedBinding = (index: number) => {
      const seedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[index]!;
      return { seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: seedCase.caseId, worldProfile: seedCase.worldProfile, seeds: seedCase.seeds, seedBindingFingerprint: evaluationFingerprint({ seedCaseId: seedCase.caseId, seeds: seedCase.seeds }) };
    };
    const result = runDeclarativeSeedExecution(operator, { operatorBinding: binding, baseCanonicalInput: input, baseCanonicalInputFingerprint: canonicalInputFingerprint(input), seedCases: [seedBinding(0), seedBinding(1)] });
    expect(result.status).toBe("PASS");
    expect(result.evidenceFingerprints).toHaveLength(2);
    expect(new Set(result.evidenceFingerprints).size).toBe(2);
    expect(new Set(seenInputs.map((value) => canonicalInputFingerprint(JSON.parse(value))))).toEqual(new Set([canonicalInputFingerprint(input)]));
    const serialized = seenInputs.join("\n");
    for (const seedCase of FROZEN_BASELINE_VALIDATION_SEED_SET.cases.slice(0, 2)) {
      expect(serialized).not.toContain(seedCase.caseId);
      expect(serialized).not.toContain(seedCase.worldProfile);
      for (const seed of Object.values(seedCase.seeds)) expect(serialized).not.toContain(String(seed));
    }
  });

  it("rejects caller repetition counts before invoking the operator", () => {
    const base = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    let calls = 0;
    const operator = { ...base, decide(value: Parameters<typeof base.decide>[0]) { calls += 1; throw new Error(String(value.opportunityId)); } };
    const input = baseInput();
    const operatorBinding = { operatorId: operator.metadata.operatorId, operatorVersion: operator.metadata.operatorVersion, implementationFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, adapterFingerprint: operator.metadata.adapterFingerprint };
    const evidence = { operatorBinding, canonicalInput: input, canonicalInputFingerprint: canonicalInputFingerprint(input), repetitions: Number.MAX_SAFE_INTEGER };
    expect(runDeclarativeRepeatedExecution(operator, evidence, "determinism").status).toBe("FAIL");
    expect(calls).toBe(0);
    expect(DETERMINISM_REPETITIONS).toBe(2);
    expect(RANDOMNESS_PROBES).toBe(3);
  });

  it("rejects oversized or duplicate seed declarations before invoking the operator", () => {
    const base = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    let calls = 0;
    const operator = { ...base, decide(value: Parameters<typeof base.decide>[0]) { calls += 1; return base.decide(value); } };
    const input = baseInput();
    const operatorBinding = { operatorId: operator.metadata.operatorId, operatorVersion: operator.metadata.operatorVersion, implementationFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, adapterFingerprint: operator.metadata.adapterFingerprint };
    const seedBinding = (index: number) => {
      const seedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[index]!;
      return { seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: seedCase.caseId, worldProfile: seedCase.worldProfile, seeds: seedCase.seeds, seedBindingFingerprint: evaluationFingerprint({ seedCaseId: seedCase.caseId, seeds: seedCase.seeds }) };
    };
    const common = { operatorBinding, baseCanonicalInput: input, baseCanonicalInputFingerprint: canonicalInputFingerprint(input) };
    expect(runDeclarativeSeedExecution(operator, { ...common, seedCases: Array.from({ length: 100_000 }, () => seedBinding(0)) }).status).toBe("FAIL");
    expect(runDeclarativeSeedExecution(operator, { ...common, seedCases: [seedBinding(0), seedBinding(0)] }).status).toBe("FAIL");
    expect(calls).toBe(0);
  });
});
