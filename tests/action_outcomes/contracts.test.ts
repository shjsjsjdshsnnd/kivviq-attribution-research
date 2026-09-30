import { describe, expect, it } from "vitest";
import {
  actionOutcomePlanSchema,
  canonicalizeActionOutcomePlan,
} from "../../src/action_outcomes/schema.js";
import {
  actionSpaceCanonicalActionSchema,
  canonicalActionSchema,
  measurableCanonicalActionSchema,
} from "../../src/canonical_action/schema.js";
import {
  fingerprintCanonicalAction,
} from "../../src/canonical_action/serialization.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import {
  measurableCompoundActionSchema,
} from "../../src/compound_action/schema.js";
import { createCompoundFixtures } from "../../src/compound_action/fixtures.js";

function outcomePlan(id = "profit.primary") {
  return {
    schemaVersion: 1 as const,
    outcomes: [
      {
        outcomeId: id,
        family: "CONTRIBUTION_PROFIT" as const,
        metricRef: "metric.contribution_profit",
        role: "PRIMARY" as const,
        measurementScope: { kind: "GLOBAL" as const },
        valueType: { kind: "MONEY" as const, currency: "CAD" },
        comparison: {
          kind: "PRE_ACTION_BASELINE" as const,
          baselineRef: "baseline.pre_action",
        },
        successCriterion: {
          kind: "DIRECTIONAL" as const,
          direction: "INCREASE" as const,
        },
        measurementWindow: {
          anchor: "ACTION_EFFECTIVE" as const,
          earliestMeaningful: { amount: 1, unit: "DAY" as const },
          primaryEvaluation: { amount: 14, unit: "DAY" as const },
          longTermFollowUp: { amount: 8, unit: "WEEK" as const },
        },
        sourceDefinitionRef: {
          registryRef: "metric_registry",
          code: "contribution_profit",
          version: "1.0.0",
        },
        evidencePolicyRef: "evidence_policy.store_profit",
      },
      {
        outcomeId: "conversion.guardrail",
        family: "CONVERSION_RATE" as const,
        metricRef: "metric.conversion_rate",
        role: "GUARDRAIL" as const,
        measurementScope: { kind: "ACTION_SCOPE" as const },
        valueType: { kind: "PERCENTAGE" as const },
        comparison: { kind: "ABSOLUTE_METRIC" as const },
        successCriterion: {
          kind: "DIRECTIONAL" as const,
          direction: "MAINTAIN" as const,
        },
        measurementWindow: {
          anchor: "ACTION_EFFECTIVE" as const,
          earliestMeaningful: { amount: 1, unit: "HOUR" as const },
          primaryEvaluation: { amount: 7, unit: "DAY" as const },
        },
        sourceDefinitionRef: {
          registryRef: "metric_registry",
          code: "conversion_rate",
          version: "1.0.0",
        },
        evidencePolicyRef: "evidence_policy.conversion",
      },
    ],
  };
}

function baseAction() {
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0",
    actionId: "action_step23_measurement",
    what: {
      actionType: "no_op.do_nothing",
      scope: { kind: "GLOBAL" },
    },
    timing: immediatePersistentBudgetTiming,
    provenance: ["evidence.step23"],
  });
}

describe("Step 23 measurable outcomes", () => {
  it("defines success evidence without embedding a predicted or realized result", () => {
    const parsed = actionOutcomePlanSchema.parse(outcomePlan());
    expect(parsed.outcomes.map(({ family }) => family)).toEqual([
      "CONTRIBUTION_PROFIT",
      "CONVERSION_RATE",
    ]);
    expect(parsed.outcomes[0]!.measurementWindow).toMatchObject({
      earliestMeaningful: { amount: 1, unit: "DAY" },
      primaryEvaluation: { amount: 14, unit: "DAY" },
      longTermFollowUp: { amount: 8, unit: "WEEK" },
    });
  });

  it("requires a primary outcome and chronologically ordered horizons", () => {
    const noPrimary: any = structuredClone(outcomePlan());
    noPrimary.outcomes[0]!.role = "SECONDARY" as const;
    noPrimary.outcomes[1]!.role = "GUARDRAIL" as const;
    expect(actionOutcomePlanSchema.safeParse(noPrimary).success).toBe(false);

    const reversed: any = structuredClone(outcomePlan());
    reversed.outcomes[0]!.measurementWindow.earliestMeaningful = {
      amount: 15,
      unit: "DAY",
    };
    expect(actionOutcomePlanSchema.safeParse(reversed).success).toBe(false);
  });

  it("requires a success-defining primary outcome and a causal comparison for incremental customers", () => {
    const observeOnly: any = structuredClone(outcomePlan());
    observeOnly.outcomes[0].successCriterion = { kind: "OBSERVE_ONLY" };
    expect(actionOutcomePlanSchema.safeParse(observeOnly).success).toBe(false);

    const incremental: any = structuredClone(outcomePlan());
    incremental.outcomes[0].family = "INCREMENTAL_CUSTOMERS";
    incremental.outcomes[0].comparison = { kind: "ABSOLUTE_METRIC" };
    expect(actionOutcomePlanSchema.safeParse(incremental).success).toBe(false);
  });

  it.each([
    ["expectedProfit", 1200],
    ["groundTruth", { bestAction: "action_secret" }],
    ["trueIncrementalROAS", 9.1],
    ["counterfactualRevenue", 9999],
  ])("rejects hidden or answer-bearing field %s", (key, value) => {
    const plan: any = structuredClone(outcomePlan());
    plan.outcomes[0]![key] = value;
    expect(actionOutcomePlanSchema.safeParse(plan).success).toBe(false);
  });

  it("canonicalizes outcome ordering deterministically", () => {
    const plan = outcomePlan();
    plan.outcomes.reverse();
    expect(
      canonicalizeActionOutcomePlan(plan).outcomes.map(({ outcomeId }) => outcomeId),
    ).toEqual(["conversion.guardrail", "profit.primary"]);
  });

  it("keeps historical v2 Actions readable while Step 23 Actions require outcomePlan", () => {
    const historical = baseAction();
    expect(canonicalActionSchema.safeParse(historical).success).toBe(true);
    expect(measurableCanonicalActionSchema.safeParse(historical).success).toBe(false);

    const measurable = { ...historical, outcomePlan: outcomePlan() };
    expect(measurableCanonicalActionSchema.safeParse(measurable).success).toBe(true);
    expect(actionSpaceCanonicalActionSchema.safeParse(measurable).success).toBe(false);
  });

  it("does not alter a historical fingerprint when the optional outcome plan is absent", () => {
    const historical = baseAction();
    expect(
      fingerprintCanonicalAction(historical),
    ).toBe(
      fingerprintCanonicalAction({ ...historical, outcomePlan: undefined }),
    );
  });

  it("requires a Step 23 compound outcome plan without invalidating historical compounds", () => {
    const historical = createCompoundFixtures()[0]!.action;
    expect(measurableCompoundActionSchema.safeParse(historical).success).toBe(false);
    expect(
      measurableCompoundActionSchema.safeParse({
        ...historical,
        components: historical.components.map((component, index) => ({
          ...component,
          action: {
            ...component.action,
            outcomePlan: outcomePlan("component." + index),
          },
        })),
        outcomePlan: outcomePlan("compound.profit"),
      }).success,
    ).toBe(true);
  });
});
