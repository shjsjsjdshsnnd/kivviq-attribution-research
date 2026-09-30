import { describe, expect, it } from "vitest";
import { evaluateFiniteActionSet, type OracleEconomics } from "../../src/evaluation/finite-decision-oracle.js";
import { validateFiniteDecision } from "../../src/evaluation/oracle-validation.js";
const candidates = [{ actionId: "a0", action: 0 }, { actionId: "a1", action: 1 }];
const values = (profit: number): OracleEconomics => ({ netSalesMinor: profit, cogsMinor: 0,
  paymentFeesMinor: 0, fulfillmentMinor: 0, shippingCostMinor: 0,
  variableOperatingCostMinor: 0, paidSpendMinor: 0, actionCostMinor: 0 });
async function train() {
  return evaluateFiniteActionSet({ actionSetVersion: "test/1", universeComplete: true,
    baselineActionId: "a0", candidates, seeds: [1, 2], scope: "test-realized-contribution", currency: "CAD",
    horizon: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" }, maximumEvaluations: 4,
    evaluate: ({ candidate, seed }) => values(seed * 10 + candidate.action * 100) });
}
describe("independent seed validation", () => {
  it("keeps the chosen training action even when its validation ranking reverses", async () => {
    const training = await train();
    const result = await validateFiniteDecision({ training, selectedActionId: "a1", candidates,
      validationSeeds: [3, 4], validationSetId: "public-validation/1", maximumEvaluations: 4,
      evaluate: ({ candidate, seed }) => values(seed * 10 - candidate.action * 100) });
    expect(result.trainingBestActionId).toBe("a1");
    expect(result.validation.bestActionId).toBe("a0");
    expect(result.selectedActionId).toBe("a1");
    expect(result.selectedDeltaVersusBaselineMinor).toBe(-100);
    expect(result.inSampleValidationRegretMinor).toBe(100);
    expect(result.expectedOptimalityProven).toBe(false);
    expect(result.selectionChangedUsingValidationData).toBe(false);
  });
  it("refuses shared seeds, altered candidate sets and a partial evaluation budget", async () => {
    const training = await train();
    const base = { training, selectedActionId: "a1", candidates, validationSeeds: [3, 4],
      validationSetId: "validation/1", maximumEvaluations: 4, evaluate: () => values(0) };
    await expect(validateFiniteDecision({ ...base, validationSeeds: [2, 3] })).rejects.toThrow("disjoint");
    await expect(validateFiniteDecision({ ...base, candidates: candidates.slice(1) })).rejects.toThrow("universe");
    await expect(validateFiniteDecision({ ...base, candidates: [{ actionId: "a0", action: 0 }, { actionId: "a1", action: 2 }] })).rejects.toThrow("universe");
    await expect(validateFiniteDecision({ ...base, maximumEvaluations: 3 })).rejects.toThrow("budget");
  });
});
