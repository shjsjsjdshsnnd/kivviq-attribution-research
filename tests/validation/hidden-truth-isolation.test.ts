import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20, pauseUnderperformingMetaCampaign } from "../../src/action_ontology/fixtures.js";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import { canonicalPolicyDecisionFingerprint, validateHiddenTruthIsolation, validateProhibitedInformationInvariance } from "../../src/validation/index.js";

const fp = (value: unknown) => evaluationFingerprint(value);
const side = (witnessValue: number, actions = [increaseGoogleShoppingBudget20]) => { const witness = { hiddenIncrementalRoas: witnessValue }; return ({
  visibleInputFingerprint: fp({ visible: 1 }), witness, witnessFingerprint: fp(witness),
  decisionFingerprint: canonicalPolicyDecisionFingerprint(actions), actions,
}); };
const pair = (rightActions = [increaseGoogleShoppingBudget20]) => ({ pairId: "pair-1", baseline: side(1), variant: side(2, rightActions) });

describe("paired information isolation", () => {
  it("uses the authoritative Action semantic projection", () => {
    const baseline = canonicalPolicyDecisionFingerprint([increaseGoogleShoppingBudget20]);
    const nonSemanticVariants = [
      { ...increaseGoogleShoppingBudget20, provenance: { ...increaseGoogleShoppingBudget20.provenance, createdAt: "2026-09-22T13:00:00Z" } },
      { ...increaseGoogleShoppingBudget20, description: "A different explanatory description." },
      { ...increaseGoogleShoppingBudget20, intent: { statement: "A different explanatory intent.", intentRef: "intent:random" } },
      { ...increaseGoogleShoppingBudget20, riskDimensions: increaseGoogleShoppingBudget20.riskDimensions.map((risk, index) => index === 0 ? { ...risk, downsideDefinition: "Different explanatory risk wording." } : risk) },
      { ...increaseGoogleShoppingBudget20, measurement: { ...increaseGoogleShoppingBudget20.measurement, primaryEvaluationSeconds: increaseGoogleShoppingBudget20.measurement.primaryEvaluationSeconds + 1 } },
    ];
    for (const variant of nonSemanticVariants) {
      expect(canonicalPolicyDecisionFingerprint([variant]), JSON.stringify(variant)).toBe(baseline);
    }

    const changedParameters = { ...increaseGoogleShoppingBudget20, parameters: { ...increaseGoogleShoppingBudget20.parameters, operation: { ...(increaseGoogleShoppingBudget20.parameters as { operation: object }).operation, factor: 1.3 } } };
    const changedTarget = { ...increaseGoogleShoppingBudget20, target: { ...increaseGoogleShoppingBudget20.target, campaignId: "different_campaign" } };
    for (const semanticVariant of [changedParameters, changedTarget, pauseUnderperformingMetaCampaign]) {
      expect(canonicalPolicyDecisionFingerprint([semanticVariant])).not.toBe(baseline);
    }
  });

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
