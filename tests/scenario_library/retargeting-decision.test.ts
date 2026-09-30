import { afterAll, describe, expect, it } from "vitest";
import { RETARGETING_SEEDS, retargetingScenarioCandidateAdmission, runRetargetingDecisionScenario, type RetargetingDecisionRecord } from "../../src/evaluation/retargeting-decision-scenario.js";

// Fixed seed registrations are never selected after observing their qualification result.
describe("retargeting decision trap through the measurement boundary", () => {
  const records: RetargetingDecisionRecord[] = [];
  afterAll(() => {
    const admission = retargetingScenarioCandidateAdmission(records);
    expect(admission.status).toBe("CANDIDATE_QUALIFIED");
    expect(admission.publicDevelopmentSeeds).toEqual([...RETARGETING_SEEDS.development]);
    expect(admission.publicValidationSeeds).toEqual([...RETARGETING_SEEDS.validation]);
    expect(admission.phase1AdversarialCoverageCounted).toBe(false);
    expect(admission.blockingReason).toBe(
      "bounded_budget_subspace_not_complete_canonical_business_action_universe",
    );
    expect(admission.candidateSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(admission.worldHash).toMatch(/^[a-f0-9]{64}$/);
    expect(admission.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  for (const seed of [...RETARGETING_SEEDS.development, ...RETARGETING_SEEDS.validation]) {
    it(`evaluates every preregistered budget decision after the same warmup (seed ${seed})`, async () => {
      const record = await runRetargetingDecisionScenario(seed);
      records.push(record);
      console.info("RETARGETING_DECISION_VALIDATION", JSON.stringify({ seed, status: record.status, predicates: record.predicates, metrics: record.metrics }));
      expect(record.result.oracle.evaluatedActions).toBe(5);
      expect(record.result.simulatorExecutions).toBe(6);
      expect(record.result.oracle.horizon.start).toBe("2026-02-01T00:00:00.000Z");
      expect(record.result.observationBySeed[0]!.payload).not.toContain("purchaseSignature");
      expect(record.result.observationBySeed[0]!.payload).not.toContain("oracle");
      expect(record.status).toBe("PASS");
    }, 180000);
  }
});
