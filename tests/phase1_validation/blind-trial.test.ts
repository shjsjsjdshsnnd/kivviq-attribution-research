import { describe, expect, it, vi } from "vitest";
import { createBlindDecisionTrial, createScheduledBlindTrial } from "../../src/evaluation/blind-decision-trial.js";
import { DECISION_PROTOCOL_VERSION, parseDecisionOffer } from "../../src/observation/decision-protocol.js";
import { evaluateExactActionSet } from "../../src/evaluation/exact-decision-oracle.js";
import { buildTractableCheckoutControl } from "../../src/evaluation/tractable-checkout-control.js";
import { finiteCandidateSetHash } from "../../src/evaluation/finite-decision-oracle.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";
import { scheduledFixture } from "./fixture.js";
function control() {
  const input = buildTractableCheckoutControl();
  const evaluate = vi.fn(() => evaluateExactActionSet(input));
  const offer = { version: DECISION_PROTOCOL_VERSION, decisionId: "decision-1", currency: input.currency,
    decisionAt: input.horizon.start, evaluationEnd: input.horizon.end, objective: "future_booked_contribution" as const,
    observation: { schemaVersion: "corrupted-observation/1.0.0" as const, asOf: input.horizon.start, orders: [], events: [], platformReports: [] },
    actions: input.candidates.map(c => ({ actionId: c.actionId, description: c.actionId === "a0" ? "Keep the current configuration" : `${c.action.kind} ${c.action.amount}` })) };
  return { evaluate, trial: createBlindDecisionTrial({ offer, candidateSetHash: finiteCandidateSetHash(input.candidates),
    experimentHash: sha256({ ...input, evaluate: null }), scope: input.scope, evaluate }) };
}
const choice = (actionId: string, extra = {}) => JSON.stringify({ version: DECISION_PROTOCOL_VERSION, decisionId: "decision-1", actionId, ...extra });
describe("choose without oracle answers, then lock and reveal to evaluator", () => {
  it("does not compute or expose oracle values before a choice, and never exposes them through the transport", async () => {
    const { evaluate, trial } = control();
    expect(parseDecisionOffer(JSON.parse(trial.handleJson("offer"))).actions).toHaveLength(37);
    await expect(trial.revealForEvaluator()).rejects.toThrow("committed"); expect(evaluate).not.toHaveBeenCalled();
    for (const operation of ["truth", "reveal", "seed", "oracle", "reset"]) expect(trial.handleJson(operation)).toBe('{"error":"INVALID_OPERATION"}');
    for (const data of [choice("missing"), choice("a0", { regretMinor: 0 }), "{}", "[", null]) expect(trial.handleJson("choose", data)).toContain("INVALID_CHOICE");
    expect(evaluate).not.toHaveBeenCalled();
    expect(trial.handleJson("choose", choice("a0"))).toContain("CHOICE_LOCKED");
    expect(evaluate).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([trial.revealForEvaluator(), trial.revealForEvaluator()]);
    expect(evaluate).toHaveBeenCalledTimes(1); expect(a).toEqual(b); expect(a.regret.regretMinor).toBeGreaterThan(0);
    expect(trial.handleJson("choose", choice(a.oracle.bestActionId))).toContain("CHOICE_ALREADY_LOCKED");
    expect(trial.handleJson("choose", choice("a0"))).toContain("CHOICE_LOCKED");
    expect(trial.handleJson("offer")).not.toContain("weightedContribution");
    expect(trial.handleJson("oracle")).not.toContain(a.choiceCommitment);
  }, 30000);
  it("binds the actual simulator offer to the same predecision world used for regret", async () => {
    const input = scheduledFixture();
    const trial = createScheduledBlindTrial({ ...input, decisionId: "decision-1", descriptions: { a0: "Keep current budgets", a1: "Add 100000 minor units per reference period to Meta; cost 100 minor units" } });
    const before = trial.handleJson("offer"), parsed = parseDecisionOffer(JSON.parse(before));
    expect(parsed.observation.asOf).toBe(input.decisionAt);
    expect(before).not.toContain("simulationSeed"); expect(before).not.toContain("godMode");
    trial.handleJson("choose", choice("a1"));
    const result = await trial.revealForEvaluator();
    expect(result.regret).toMatchObject({ reference: "realized_seed_optimum", expectedRegretVerified: false });
    expect(result.regret.regretMinor).toBe(300099);
    expect(trial.handleJson("offer")).toBe(before);
  }, 90000);
});
