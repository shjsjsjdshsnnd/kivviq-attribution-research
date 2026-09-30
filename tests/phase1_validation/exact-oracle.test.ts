import { describe, expect, it } from "vitest";
import { evaluateExactActionSet, exactDecisionRegret, finiteIntegerGrid } from "../../src/evaluation/exact-decision-oracle.js";
import { buildTractableCheckoutControl } from "../../src/evaluation/tractable-checkout-control.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";
import type { OracleEconomics } from "../../src/evaluation/finite-decision-oracle.js";
const economics = (revenue: number, cost = 0): OracleEconomics => ({ netSalesMinor: revenue, cogsMinor: 0, paymentFeesMinor: 0,
  fulfillmentMinor: 0, shippingCostMinor: 0, variableOperatingCostMinor: 0, paidSpendMinor: cost, actionCostMinor: 0 });
function input() {
  return { modelVersion: "analytic-demand/1", modelParameters: { base: 100 }, actionSetVersion: "actions/1", completeActionSet: true,
    completeOutcomeSupport: true, baselineActionId: "a0", candidates: [{ actionId: "a0", action: 0 }, { actionId: "a1", action: 1 }],
    outcomes: [{ outcomeId: "low", world: 0, weight: 3 }, { outcomeId: "high", world: 1, weight: 1 }],
    currency: "CAD", scope: "analytic_control", horizon: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" }, maximumEvaluations: 4,
    evaluate: ({ action, world, parameters }: { action: number; world: number; parameters: { base: number } }) => economics(parameters.base + (action ? (world ? 40 : -4) : 0)) };
}
describe("complete finite support ground-truth oracle", () => {
  it("uses probability-weighted expectations, not hindsight winners or a sample maximum", async () => {
    const result = await evaluateExactActionSet(input());
    expect(result.bestActionId).toBe("a1");
    expect(result.ranking[0]!.expectedDeltaVersusBaselineMinor).toBe(7);
    expect(exactDecisionRegret(result, "a0")).toMatchObject({ regretMinor: 7, exactRegretMinor: { numerator: "28", denominator: "4" } });
    // Mean statewise maximum uplift is 10; choosing one action before U is known yields 7.
    expect(exactDecisionRegret(result, "a0").regretMinor).not.toBe(10);
    expect(exactDecisionRegret(result, "a1").regretMinor).toBe(0);
  });
  it("ranks exact integer masses even when a floating display cannot distinguish the means", async () => {
    const n = Number.MAX_SAFE_INTEGER;
    const result = await evaluateExactActionSet({ ...input(), outcomes: [{ outcomeId: "low", world: 0, weight: n }, { outcomeId: "high", world: 1, weight: 1 }],
      evaluate: ({ action, world }) => economics(n - 1 + (action && world ? 1 : 0)) });
    expect(result.bestActionId).toBe("a1");
    expect(exactDecisionRegret(result, "a0").exactRegretMinor).toEqual({ numerator: "1", denominator: "9007199254740992" });
  });
  it("preserves ties with deterministic IDs and input order invariance", async () => {
    const original = input(), first = await evaluateExactActionSet(original);
    const second = await evaluateExactActionSet({ ...original, candidates: [...original.candidates].reverse(), outcomes: [...original.outcomes].reverse() });
    expect(second).toEqual(first);
    const tied = await evaluateExactActionSet({ ...input(), evaluate: () => economics(1) });
    expect(tied.tiedBestActionIds).toEqual(["a0", "a1"]);
    expect(exactDecisionRegret(tied, "a1").regretMinor).toBe(0);
  });
  it("fails rather than ranking a partial universe, truncated support or a surviving subset", async () => {
    for (const patch of [{ completeActionSet: false }, { completeOutcomeSupport: false }, { maximumEvaluations: 3 }, { outcomes: [] },
      { outcomes: [{ outcomeId: "x", world: 0, weight: 0 }] }, { outcomes: [{ outcomeId: "x", world: 0, weight: 1.5 }] },
      { outcomes: [input().outcomes[0]!, input().outcomes[0]!] }, { baselineActionId: "missing" }]) {
      await expect(evaluateExactActionSet({ ...input(), ...patch })).rejects.toThrow();
    }
    await expect(evaluateExactActionSet({ ...input(), evaluate: () => { throw Error("branch"); } })).rejects.toThrow("branch");
  });
  it("isolates callback mutation, includes nonbuyer expense and rejects malformed economics", async () => {
    const original = input();
    const before = sha256({ ...original, evaluate: null });
    const result = await evaluateExactActionSet({ ...original, evaluate: ({ parameters }) => { parameters.base = 0; return economics(0, 3); } });
    expect(result.ranking.every(r => r.expectedContributionMinor === -3)).toBe(true);
    expect(sha256({ ...original, evaluate: null })).toBe(before);
    await expect(evaluateExactActionSet({ ...input(), evaluate: () => ({ ...economics(10), cogsMinor: -1 }) })).rejects.toThrow();
    const corrupt = structuredClone(result); (corrupt.ranking[0] as { weightedContribution: string }).weightedContribution = "999";
    expect(() => exactDecisionRegret(corrupt, "a0")).toThrow("integrity");
  });
  it("executes all 37 registered decisions against all 256 independent-buyer states", async () => {
    const control = buildTractableCheckoutControl(), result = await evaluateExactActionSet(control);
    expect(result.ranking).toHaveLength(37); expect(result.evaluations).toBe(9472);
    expect(result.probabilityDenominator).toBe("256");
    expect(result.ledger.every(r => r.economics.netSalesMinor <= control.modelParameters.stock * control.modelParameters.unitPriceMinor)).toBe(true);
    expect(result.ranking.find(r => r.actionId === "meta-10")!.expectedDeltaVersusBaselineMinor).toBe(-100000);
    expect(result.ranking[0]!.expectedDeltaVersusBaselineMinor).toBeGreaterThan(0);
    expect(exactDecisionRegret(result, "a0").regretMinor).toBeGreaterThan(0);
  }, 30000);
  it("recovers doubled demand and a known 20% intervention in registered analytic controls", async () => {
    const result = await evaluateExactActionSet({ ...input(), candidates: [{ actionId: "a0", action: 100 }, { actionId: "a1", action: 120 }, { actionId: "a2", action: 200 }], maximumEvaluations: 6,
      evaluate: ({ action }) => economics(action * 500) });
    const base = result.ranking.find(r => r.actionId === "a0")!.expectedContributionMinor;
    expect(result.ranking.find(r => r.actionId === "a1")!.expectedContributionMinor / base).toBe(1.2);
    expect(result.ranking.find(r => r.actionId === "a2")!.expectedContributionMinor / base).toBe(2);
  });
  it("rejects self-rehashed false scores and missing outcome rows", async () => {
    const result = await evaluateExactActionSet(input());
    const wrong = structuredClone(result);
    (wrong.ranking[0] as { weightedContribution: string }).weightedContribution = "999";
    const { resultHash: _old, ...payload } = wrong;
    (wrong as { resultHash: string }).resultHash = sha256(payload);
    expect(() => exactDecisionRegret(wrong, "a0")).toThrow("reconcile");
    const missing = { ...result, ledger: result.ledger.slice(1), evaluations: result.evaluations - 1 };
    const { resultHash: _hash, ...incomplete } = missing; missing.resultHash = sha256(incomplete);
    expect(() => exactDecisionRegret(missing, "a0")).toThrow("incomplete");
  });
  it("enumerates a complete bounded grid or rejects it, without claiming continuous optimality", () => {
    expect(finiteIntegerGrid(-10, 10, 5)).toEqual([-10, -5, 0, 5, 10]);
    expect(() => finiteIntegerGrid(0, 11, 5)).toThrow("endpoint");
    expect(() => finiteIntegerGrid(0, 100, 1, 100)).toThrow("budget");
    expect(() => finiteIntegerGrid(0, 10, 0)).toThrow();
  });
});
