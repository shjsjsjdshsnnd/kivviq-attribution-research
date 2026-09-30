import { beforeAll, describe, expect, it } from "vitest";
import { buildMeasurementScenario } from "../../src/evaluation/scenario-library.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { evaluateScheduledDecisionSet, type ScheduledDecisionInput } from "../../src/evaluation/scheduled-decision-oracle.js";
import { SCHEDULED_SPEND_VERSION } from "../../src/evaluation/scheduled-spend.js";
import { oracleContribution } from "../../src/evaluation/finite-decision-oracle.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";
import { InteractiveReplayWorld } from "../../src/evaluation/interactive-world.js";
import { createObservedWorldEndpoint } from "../../src/evaluation/observed-world-endpoint.js";
import { OBSERVED_WORLD_PROTOCOL_VERSION, parseObservedWorldResponse } from "../../src/observation/world-protocol.js";

function fixture(): ScheduledDecisionInput {
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
    decisionAt: "2026-01-02T00:00:00.000Z",
    evaluationCutoffs: ["2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z", endTime],
    candidates: [
      { actionId: "a0", action: { actionId: "a0", interventions: [], actionCostMinor: 0 } },
      { actionId: "a1", action: { actionId: "a1", interventions: [], actionCostMinor: 17,
        budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] } },
    ], baselineActionId: "a0", actionSetVersion: "multi-horizon-test/1", universeComplete: true,
    seeds: [1410], maximumEvaluations: 3,
  };
}

describe("fixed-episode multi-horizon decision evaluation", () => {
  let input: ScheduledDecisionInput, result: Awaited<ReturnType<typeof evaluateScheduledDecisionSet>>;
  beforeAll(async () => { input = fixture(); result = await evaluateScheduledDecisionSet(input); }, 90000);
  it("computes all checkpoints from one simulation per branch, with no extra shortened-world replays", () => {
    expect(result.simulatorExecutions).toBe(3);
    expect(result.access).toBe("evaluator_only");
    expect(result.oracle.horizon).toEqual({ start: input.decisionAt, end: input.initial.endTime });
    for (const branch of result.branches) {
      expect(branch.checkpoints.map(c => c.asOf)).toEqual(input.evaluationCutoffs);
      expect(branch.checkpoints.at(-1)!.economics).toEqual(branch.economics);
      expect(branch.checkpoints.every(c => c.firstPurchaseOrders <= c.futureOrders)).toBe(true);
      expect(branch.checkpoints.map(c => c.futureOrders)).toEqual(branch.checkpoints.map(c => c.futureOrders).sort((a, b) => a - b));
    }
  });
  it("accrues the same fixed daily rate and charges implementation cost exactly once at every cumulative horizon", () => {
    const control = result.branches.find(b => b.actionId === "a0")!;
    const scale = result.branches.find(b => b.actionId === "a1")!;
    for (let i = 0; i < control.checkpoints.length; i += 1) {
      const a = control.checkpoints[i]!, b = scale.checkpoints[i]!;
      // The decision starts at cutoff+1ms; cumulative flooring carries the fraction.
      const extraSpend = 100000 * (i + 1) - 1;
      expect(b.economics.netSalesMinor).toBe(a.economics.netSalesMinor);
      expect(b.economics.paidSpendMinor - a.economics.paidSpendMinor).toBe(extraSpend);
      expect(b.economics.actionCostMinor).toBe(17);
      expect(oracleContribution(b.economics) - oracleContribution(a.economics)).toBe(-extraSpend - 17);
    }
  });
  it("adding reporting cutoffs changes neither full-world results nor the predecision information", async () => {
    const hash = sha256(input);
    const { evaluationCutoffs: _cutoffs, ...withoutCheckpoints } = input;
    const plain = await evaluateScheduledDecisionSet(withoutCheckpoints);
    expect(plain.oracle).toEqual(result.oracle);
    expect(plain.observationBySeed).toEqual(result.observationBySeed);
    expect(plain.branches.map(({ checkpoints: _c, ...b }) => b)).toEqual(result.branches.map(({ checkpoints: _c, ...b }) => b));
    expect(plain.branches.every(b => b.checkpoints.length === 0)).toBe(true);
    expect(sha256(input)).toBe(hash);
    expect(plain.inputHash).not.toBe(result.inputHash);
  }, 90000);
  it("rejects hindsight, horizon overflow, duplicates, out-of-order cutoffs and partial expense days", async () => {
    for (const evaluationCutoffs of [
      [input.decisionAt], [input.initial.startTime], ["2026-01-06T00:00:00.000Z"],
      ["2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
      ["2026-01-04T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
      ["2026-01-03T12:00:00.000Z"], ["not-a-date"],
    ]) await expect(evaluateScheduledDecisionSet({ ...input, evaluationCutoffs })).rejects.toThrow();
  });
  it("binds an actual world to the wire boundary without exposing evaluator reset, diagnostics or future results", () => {
    const world = new InteractiveReplayWorld({ initial: input.initial, spendPlan: input.spendPlan,
      measurement: { ...input.measurement, platformSpend: [] }, actions: input.candidates.map(c => c.action), stepMs: 86400000 });
    const endpoint = createObservedWorldEndpoint(world.observedHandle());
    const request = (operation: string, extra = {}) => JSON.stringify({ version: OBSERVED_WORLD_PROTOCOL_VERSION, operation, ...extra });
    const first = endpoint(request("observe"));
    const stepped = parseObservedWorldResponse(JSON.parse(endpoint(request("step", { actionId: "a0" }))));
    expect(stepped.ok).toBe(true);
    if (stepped.ok) expect(stepped.observation.asOf).toBe(input.decisionAt);
    const current = endpoint(request("observe"));
    for (const operation of ["reset", "truth", "oracle", "evaluatorSnapshot", "evaluatorSpendSnapshot"]) {
      expect(JSON.parse(endpoint(request(operation)))).toEqual({ version: OBSERVED_WORLD_PROTOCOL_VERSION, ok: false, error: "INVALID_REQUEST" });
      expect(endpoint(request("observe"))).toBe(current);
    }
    expect(endpoint(request("step", { actionId: "missing" }))).toContain('"UNKNOWN_ACTION"');
    expect(endpoint(request("observe"))).toBe(current);
    world.reset(input.seeds[0]!); // Evaluator capability, not an RPC operation.
    expect(endpoint(request("observe"))).toBe(first);
    expect(parseObservedWorldResponse(JSON.parse(current))).not.toHaveProperty("checkpoints");
  }, 90000);
});
