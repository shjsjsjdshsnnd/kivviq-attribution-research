import { describe, expect, it } from "vitest";
import { buildRetargetingDecisionScenario } from "../../src/evaluation/retargeting-decision-scenario.js";
import { evaluateScheduledDecisionSet } from "../../src/evaluation/scheduled-decision-oracle.js";
import { requestWithScheduledSpend } from "../../src/evaluation/scheduled-spend.js";
import { utcTimestamp } from "../../src/core/units.js";

describe("prospective finite-oracle contract", () => {
  it("requires all actions plus warmup executions before running an incomplete search", async () => {
    const input = { ...buildRetargetingDecisionScenario(), seeds: [105002], maximumEvaluations: 6 };
    await expect(evaluateScheduledDecisionSet({ ...input, universeComplete: false })).rejects.toThrow("complete candidates");
    await expect(evaluateScheduledDecisionSet({ ...input, maximumEvaluations: 5 })).rejects.toThrow("warmup");
    await expect(evaluateScheduledDecisionSet({ ...input, seeds: [1, 1], maximumEvaluations: 12 })).rejects.toThrow();
    await expect(evaluateScheduledDecisionSet({ ...input, candidates: [input.candidates[0]!, input.candidates[0]!] })).rejects.toThrow();
  });
  it("rejects hindsight, a non-no-op baseline, and schedules that edit already observed history", async () => {
    const input = { ...buildRetargetingDecisionScenario(), seeds: [105002], maximumEvaluations: 6 };
    await expect(evaluateScheduledDecisionSet({ ...input, decisionAt: input.initial.endTime })).rejects.toThrow("warmup");
    await expect(evaluateScheduledDecisionSet({ ...input, decisionAt: "2026-02-01T12:00:00.000Z" })).rejects.toThrow("closed-day");
    await expect(evaluateScheduledDecisionSet({ ...input, baselineActionId: "a1" })).rejects.toThrow("true no-op");
    const candidate = { actionId: "x", action: { actionId: "x", actionCostMinor: 0, interventions: [{
      variable: "pricing.product_price", operation: "set" as const,
      value: { kind: "number" as const, unit: "money_minor" as const, value: 1000 },
      effectiveAt: utcTimestamp(input.initial.startTime),
    }] } };
    await expect(evaluateScheduledDecisionSet({ ...input, candidates: [input.candidates[0]!, candidate] })).rejects.toThrow("unsupported scheduled");
  });
  it("normalizes daily rates to the fixed episode, rejecting unrepresentable coefficients rather than rounding silently", () => {
    const input = buildRetargetingDecisionScenario();
    const daily = { ...input.spendPlan, referencePeriodMs: 86400000 };
    const request = requestWithScheduledSpend(input.initial, daily);
    const meta = request.interventions!.find(i => i.variable === "marketing.meta.spend")!;
    expect(meta.value).toEqual({ kind: "number", value: 45000 * 120, unit: "money_minor" });
    expect(() => requestWithScheduledSpend(input.initial, { ...daily, referencePeriodMs: 7 * 86400000,
      initialAllocation: { ...daily.initialAllocation, meta: 1 } })).toThrow("not representable");
  });
});
