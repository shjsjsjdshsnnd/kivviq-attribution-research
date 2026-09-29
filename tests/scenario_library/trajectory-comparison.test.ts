import { beforeAll, describe, expect, it } from "vitest";
import { compareInterventionTrajectories, type TrajectoryComparisonInput } from "../../src/evaluation/trajectory-comparison.js";
import { buildMeasurementScenario } from "../../src/evaluation/scenario-library.js";
import { SCHEDULED_SPEND_VERSION } from "../../src/evaluation/scheduled-spend.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";

function setup(): TrajectoryComparisonInput {
  const built = buildMeasurementScenario("adv-013", 1410);
  const startTime = "2026-01-01T00:00:00.000Z", endTime = "2026-01-05T00:00:00.000Z";
  return {
    initial: { ...built.request, startTime, endTime,
      latentPopulation: generateCustomerPopulation({ merchantWorld: built.request.merchantWorld, populationSeed: 74111,
        populationConfig: { maxExplicitAgents: 12, complexity: "adversarial", maxCategoryPreferences: 4, maxProductPreferences: 6 } }),
      interventions: built.request.interventions!.filter(i => !i.variable.startsWith("marketing.")) },
    measurement: { corruption: built.controlCorruption, scope: "explicit_simulated_agents" },
    spendPlan: { version: SCHEDULED_SPEND_VERSION, periodStart: startTime, periodEnd: endTime,
      referencePeriodMs: 86400000, scope: "explicit_simulated_agents", execution: "fully_spent_time_prorated_allocation",
      initialAllocation: { meta: 10000, google_search: 20000, google_shopping: 0, pinterest: 0, affiliate: 0 }, changes: [] },
    actions: [
      { actionId: "a0", interventions: [], actionCostMinor: 0 },
      { actionId: "a1", interventions: [], actionCostMinor: 17, budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] },
      { actionId: "a2", interventions: [], actionCostMinor: 23, budgetAdjustments: [{ channel: "google_search", operation: "delta", amountMinor: 100000 }] },
      { actionId: "a3", interventions: [], actionCostMinor: 0, budgetAdjustments: [{ channel: "meta", operation: "set", amountMinor: 0 }] },
      { actionId: "a4", interventions: [], actionCostMinor: 0, budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: -999999 }] },
    ],
    actionSetVersion: "trajectory-test-subspace/1", noOpActionId: "a0", stepMs: 86400000, warmupSteps: 1,
    trajectories: [
      { trajectoryId: "t0", actionIds: ["a0", "a0"] },
      { trajectoryId: "t1", actionIds: ["a1", "a0"] },
      { trajectoryId: "t2", actionIds: ["a2", "a0"] },
    ], baselineTrajectoryId: "t0", seeds: [1410, 1411], maximumSimulations: 25,
  };
}

describe("exact-reset counterfactual intervention trajectories", () => {
  let input: TrajectoryComparisonInput, result: ReturnType<typeof compareInterventionTrajectories>;
  beforeAll(() => { input = setup(); result = compareInterventionTrajectories(input); }, 90000);
  it("gives every alternative the same initial truth, warmup and decision economics within each seed", () => {
    for (const seed of input.seeds) {
      const rows = result.consequences.filter(r => r.seed === seed);
      expect(new Set(rows.map(r => r.initialTruthHash)).size).toBe(1);
      expect(new Set(rows.map(r => sha256(r.warmupObservationHashes))).size).toBe(1);
      expect(new Set(rows.map(r => r.decisionObservationHash)).size).toBe(1);
      expect(new Set(rows.map(r => r.decisionEconomicsHash)).size).toBe(1);
    }
    expect(result.access).toBe("evaluator_only");
    expect(result.interpretation).toBe("paired_seed_sample_estimates");
    expect(result.simulations).toBe(25);
    expect(result.decisionAt).toBe("2026-01-02T00:00:00.000Z");
    expect(result.evaluationEnd).toBe("2026-01-04T00:00:00.000Z");
  });
  it("reconciles true incremental spend and action costs rather than credited revenue", () => {
    for (const seed of input.seeds) {
      const rows = result.consequences.filter(r => r.seed === seed), baseline = rows.find(r => r.trajectoryId === "t0")!;
      expect(baseline.deltaVersusBaselineMinor).toBe(0);
      for (const row of rows.filter(r => r.trajectoryId !== "t0")) {
        expect(row.futurePurchaseHash).toBe(baseline.futurePurchaseHash);
        expect(row.economics.netSalesMinor).toBe(baseline.economics.netSalesMinor);
        expect(row.economics.paidSpendMinor - baseline.economics.paidSpendMinor).toBe(199999);
        expect(row.deltaVersusBaselineMinor).toBe(-199999 - row.economics.actionCostMinor);
      }
    }
  });
  it("is replay-identical, candidate-order invariant and does not mutate caller inputs", () => {
    const before = sha256(input);
    const replay = compareInterventionTrajectories({ ...input, seeds: [...input.seeds].reverse(),
      trajectories: [...input.trajectories].reverse(), actions: [...input.actions].reverse() });
    expect(replay).toEqual(result);
    expect(sha256(input)).toBe(before);
  }, 90000);
  it("retains sequential budget changes and resets them before the no-op branch", () => {
    const changed = compareInterventionTrajectories({ ...input, seeds: [1410], maximumSimulations: 9,
      trajectories: [{ trajectoryId: "t0", actionIds: ["a0", "a0"] }, { trajectoryId: "t1", actionIds: ["a1", "a3"] }] });
    expect(changed.interpretation).toBe("single_seed_realized_counterfactuals");
    const off = changed.consequences.find(r => r.trajectoryId === "t1")!;
    expect(off.economics.paidSpendMinor).toBeLessThan(result.consequences.find(r => r.seed === 1410 && r.trajectoryId === "t1")!.economics.paidSpendMinor);
    expect(changed.consequences.find(r => r.trajectoryId === "t0")!.finalObservationHash).toBe(result.consequences.find(r => r.seed === 1410 && r.trajectoryId === "t0")!.finalObservationHash);
  }, 90000);
  it("rejects incomparable horizons, duplicate seeds/IDs, unknown actions, and an insufficient execution budget", () => {
    for (const patch of [
      { seeds: [1410, 1410] }, { seeds: [] }, { seeds: [-1] }, { maximumSimulations: 24 },
      { warmupSteps: 0 }, { stepMs: 1000 }, { warmupSteps: 4 }, { actionSetVersion: "" },
      { trajectories: [...input.trajectories, input.trajectories[0]!] },
      { trajectories: [{ trajectoryId: "t0", actionIds: ["a1"] }] },
      { trajectories: [{ trajectoryId: "t0", actionIds: ["a0"] }, { trajectoryId: "t1", actionIds: ["missing"] }] },
      { trajectories: [{ trajectoryId: "t0", actionIds: ["a0"] }, { trajectoryId: "t1", actionIds: ["a1", "a0"] }] },
    ]) expect(() => compareInterventionTrajectories({ ...input, ...patch })).toThrow();
  });
  it("aborts the entire comparison on a failed branch instead of ranking surviving alternatives", () => {
    expect(() => compareInterventionTrajectories({ ...input, seeds: [1410], maximumSimulations: 9,
      trajectories: [{ trajectoryId: "t0", actionIds: ["a0", "a0"] }, { trajectoryId: "t1", actionIds: ["a4", "a0"] }] })).toThrow();
  }, 90000);
});
