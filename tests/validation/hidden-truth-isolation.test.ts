import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20, pauseUnderperformingMetaCampaign } from "../../src/action_ontology/fixtures.js";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import { canonicalPolicyDecisionFingerprint, validateHiddenTruthIsolation, validateProhibitedInformationInvariance } from "../../src/validation/index.js";

const fp = (value: unknown) => evaluationFingerprint(value);
const side = (witness: number, actions = [increaseGoogleShoppingBudget20]) => ({
  visibleInputFingerprint: fp({ visible: 1 }), witnessFingerprint: fp({ witness }),
  decisionFingerprint: canonicalPolicyDecisionFingerprint(actions), actions,
});
const pair = (rightActions = [increaseGoogleShoppingBudget20]) => ({ pairId: "pair-1", baseline: side(1), variant: side(2, rightActions) });

describe("paired information isolation", () => {
  it("passes hidden-truth and prohibited-information pairs only when decisions are invariant", () => {
    expect(validateHiddenTruthIsolation([pair()])).toMatchObject({ checkId: "hidden_truth_isolation", status: "PASS", issues: [] });
    expect(validateProhibitedInformationInvariance([pair()])).toMatchObject({ checkId: "prohibited_information_invariance", status: "PASS", issues: [] });
    expect(Object.isFrozen(validateHiddenTruthIsolation([pair()]))).toBe(true);
    expect(validateHiddenTruthIsolation([pair([pauseUnderperformingMetaCampaign])])).toMatchObject({ status: "FAIL", issues: [{ code: "HIDDEN_TRUTH_LEAKAGE" }] });
    expect(validateProhibitedInformationInvariance([pair([pauseUnderperformingMetaCampaign])])).toMatchObject({ status: "FAIL", issues: [{ code: "PROHIBITED_INFORMATION_LEAKAGE" }] });
  });

  it("ignores provenance-only action IDs in canonical policy decisions", () => {
    const changed = { ...increaseGoogleShoppingBudget20, actionId: "action_random_provenance_id" } as typeof increaseGoogleShoppingBudget20;
    expect(validateHiddenTruthIsolation([{ pairId: "provenance", baseline: side(1), variant: side(2, [changed]) }])).toMatchObject({ status: "PASS", issues: [] });
  });

  it("reports stable invalid paired evidence for equal witnesses, changed visible input, forged decisions, duplicates, and unknown keys", () => {
    const changedVisible = pair();
    const cases: unknown[] = [
      { ...pair(), variant: side(1) },
      { ...changedVisible, variant: { ...changedVisible.variant, visibleInputFingerprint: fp({ visible: 2 }) } },
      { ...pair(), variant: { ...side(2), decisionFingerprint: fp({ forged: true }) } },
      { ...pair(), ambient: true },
      [pair(), pair()],
    ];
    for (const value of cases) {
      const evidence = Array.isArray(value) ? value : [value];
      expect(validateHiddenTruthIsolation(evidence as never).issues.map((x) => x.code)).toContain("INVALID_PAIRED_EVIDENCE");
    }
  });
});
