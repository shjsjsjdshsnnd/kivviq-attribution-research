import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import {
  fullTranslationContext,
  increaseGoogleShoppingBudget20,
} from "../../src/action_translation/fixtures.js";
import {
  syntheticBusinessStateBenchmark,
  translateStateBoundCanonicalAction,
  type BusinessActionCandidate,
} from "../../src/business_state/index.js";
import { withTranslationEligibility } from "../action_translation/eligibility-helper.js";

function scenario(id: string) {
  const found = syntheticBusinessStateBenchmark().find(
    (item) => item.scenarioId === id,
  );
  if (found === undefined) throw new Error("Missing scenario " + id);
  return found.snapshot;
}

function nativeFixture() {
  const action = adaptLegacyAction(increaseGoogleShoppingBudget20);
  const translationContext = withTranslationEligibility(action, {
    timing: { approvedClock: "2026-09-21T13:00:00Z" },
    simulator: fullTranslationContext,
  });
  return { action, translationContext };
}

function candidate(
  actionId: string,
  overrides: Partial<BusinessActionCandidate> = {},
): BusinessActionCandidate {
  return {
    actionId,
    description: "Increase Google Shopping budget by 20%.",
    simulatorInterventionRef: "native:canonical-action",
    requiredMetrics: [
      { metricId: "contribution_profit", minimumConfidence: "PARTIAL" },
    ],
    requiredConstraintIds: [],
    expectedConsequences: [
      {
        metricId: "contribution_profit",
        expectedDirection: "UNKNOWN",
        horizonDays: 30,
        confidence: "UNCERTAIN",
        measurementMethod: "native simulator counterfactual",
      },
    ],
    ...overrides,
  };
}

describe("Business State native Action Space integration", () => {
  it("gates a canonical Action with Business State before native translation", () => {
    const { action, translationContext } = nativeFixture();
    const result = translateStateBoundCanonicalAction(
      scenario("state-growth"),
      {
        candidate: candidate(action.actionId),
        canonicalAction: action,
        translationContext,
      },
    );

    expect(result.status).toBe("NATIVE_TRANSLATED");
    expect(result.automaticDecisionAllowed).toBe(false);
    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      interventionType: "budget",
      operation: {
        kind: "MULTIPLY",
        factor: 1.2,
      },
    });
  });

  it("blocks a native Action before translation when Business State conflicts with it", () => {
    const { action, translationContext } = nativeFixture();
    const result = translateStateBoundCanonicalAction(
      scenario("adv-scale-with-four-days-stock"),
      {
        candidate: candidate(action.actionId, {
          forbiddenSignals: ["inventory_constrained"],
        }),
        canonicalAction: action,
        translationContext,
      },
    );

    expect(result.status).toBe("BLOCKED_BY_BUSINESS_STATE");
    expect(result.interventions).toEqual([]);
    expect(result.assessment.reasons).toContain(
      "FORBIDDEN_STATE_SIGNAL:inventory_constrained",
    );
  });

  it("abstains before native translation when required state confidence is insufficient", () => {
    const { action, translationContext } = nativeFixture();
    const result = translateStateBoundCanonicalAction(
      scenario("state-measurement-failure"),
      {
        candidate: candidate(action.actionId, {
          requiredMetrics: [
            { metricId: "cogs_coverage", minimumConfidence: "KNOWN" },
          ],
        }),
        canonicalAction: action,
        translationContext,
      },
    );

    expect(result.status).toBe("ABSTAINED_BY_BUSINESS_STATE");
    expect(result.interventions).toEqual([]);
  });

  it("refuses to bind a candidate to a different canonical Action identity", () => {
    const { action, translationContext } = nativeFixture();
    expect(() =>
      translateStateBoundCanonicalAction(scenario("state-growth"), {
        candidate: candidate("different-action"),
        canonicalAction: action,
        translationContext,
      }),
    ).toThrow(/actionId must match/);
  });
});
