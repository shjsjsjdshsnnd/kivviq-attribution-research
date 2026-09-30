import { describe, expect, it } from "vitest";
import { buildProspectingCutDecisionScenario, PROSPECTING_CUT_SEEDS, verifyProspectingCutMechanism } from "../../src/evaluation/prospecting-cut-decision-scenario.js";

/** Logic-only fixtures, NOT simulator evidence or accepted adversarial scenarios. */
function evidence() {
  const economics = (sales: number, spend: number) => ({ netSalesMinor: sales, paidSpendMinor: spend,
    cogsMinor: 0, paymentFeesMinor: 0, fulfillmentMinor: 0, shippingCostMinor: 0, variableOperatingCostMinor: 0, actionCostMinor: 0 });
  const checkpoint = (asOf: string, sales: number, spend: number, orders: number, first: number, search: number) => ({
    asOf, economics: economics(sales, spend), futureOrders: orders, firstPurchaseOrders: first, brandedSearchEvents: search });
  return { branches: [
    { seed: 1, actionId: "a0", requestHash: "control", observationHash: "same", purchaseSignature: "control",
      economics: economics(10000, 5000), checkpoints: [checkpoint("2026-02-07T00:00:00.000Z", 1000, 500, 2, 1, 20), checkpoint("2026-05-01T00:00:00.000Z", 10000, 5000, 20, 10, 200)] },
    { seed: 1, actionId: "a1", requestHash: "cut", observationHash: "same", purchaseSignature: "cut",
      economics: economics(6000, 4000), checkpoints: [checkpoint("2026-02-07T00:00:00.000Z", 1000, 400, 2, 1, 20), checkpoint("2026-05-01T00:00:00.000Z", 6000, 4000, 12, 5, 100)] },
  ] };
}

describe("prospecting-cut qualification is evidence, not a scenario title", () => {
  it("registers disjoint public seed sets and one fixed episode before evaluating any shorter horizon", () => {
    expect(PROSPECTING_CUT_SEEDS).toEqual({ development: [93120, 93121], validation: [193120, 193121] });
    expect(new Set([...PROSPECTING_CUT_SEEDS.development, ...PROSPECTING_CUT_SEEDS.validation]).size).toBe(4);
    const scenario = buildProspectingCutDecisionScenario();
    expect(scenario.initial.startTime).toBe("2026-01-01T00:00:00.000Z");
    expect(scenario.initial.endTime).toBe("2026-05-01T00:00:00.000Z");
    expect(scenario.decisionAt).toBe("2026-01-31T00:00:00.000Z");
    expect(scenario.evaluationCutoffs).toEqual(["2026-02-07T00:00:00.000Z", scenario.initial.endTime]);
    expect(scenario.spendPlan.referencePeriodMs).toBe(120 * 86400000);
    expect(scenario.spendPlan.changes).toEqual([]);
    expect(scenario.candidates.map(c => c.actionId)).toEqual(["a0", "a1"]);
  });
  it("requires ALL registered predicates, even for the deliberately valid logic fixture", () => {
    const report = verifyProspectingCutMechanism(evidence());
    expect(report.status).toBe("PASS");
    expect(report.predicates).toHaveLength(8);
    expect(report.predicates.every(p => p.passed)).toBe(true);
    expect(report.qualification).toBe("finite_budget_subspace_not_full_phase1_acceptance");
  });
  it("does not confuse fewer branded searches with lost sales or long-term profit", () => {
    const input = evidence();
    const control = input.branches[0]!.checkpoints[1]!, cut = input.branches[1]!.checkpoints[1]!;
    cut.economics.netSalesMinor = control.economics.netSalesMinor;
    cut.firstPurchaseOrders = control.firstPurchaseOrders;
    const report = verifyProspectingCutMechanism(input);
    expect(report.status).toBe("FAIL");
    expect(report.predicates.filter(p => !p.passed).map(p => p.id)).toEqual([
      "long_term_booked_contribution_declines", "long_term_net_sales_decline", "long_term_first_purchase_orders_decline",
    ]);
    expect(report.metrics.longContributionDeltaMinor).toBeGreaterThan(0);
  });
  it("fails when an action rewrites its decision evidence, commerce is vacuous, or actual savings are absent", () => {
    const mutated = evidence(); mutated.branches[1]!.observationHash = "different";
    expect(verifyProspectingCutMechanism(mutated).status).toBe("FAIL");
    const vacuous = evidence(); vacuous.branches[0]!.checkpoints[0]!.futureOrders = 0;
    expect(verifyProspectingCutMechanism(vacuous).status).toBe("FAIL");
    const noSavings = evidence(); noSavings.branches[1]!.checkpoints[0]!.economics.paidSpendMinor = 500;
    expect(verifyProspectingCutMechanism(noSavings).status).toBe("FAIL");
  });
  it("rejects missing/duplicate/unpaired branches and changed registered evaluation windows", () => {
    const input = evidence();
    expect(() => verifyProspectingCutMechanism({ branches: [input.branches[0]!] })).toThrow();
    expect(() => verifyProspectingCutMechanism({ branches: [input.branches[0]!, input.branches[0]!] })).toThrow();
    const otherSeed = evidence(); otherSeed.branches[1]!.seed = 2;
    expect(() => verifyProspectingCutMechanism(otherSeed)).toThrow();
    const noCheckpoint = evidence(); noCheckpoint.branches[1]!.checkpoints.pop();
    expect(() => verifyProspectingCutMechanism(noCheckpoint)).toThrow();
    const changedWindow = evidence(); changedWindow.branches[1]!.checkpoints[1]!.asOf = "2026-04-01T00:00:00.000Z";
    expect(() => verifyProspectingCutMechanism(changedWindow)).toThrow();
  });
});
