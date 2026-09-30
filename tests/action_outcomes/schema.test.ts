import { describe, expect, it } from "vitest";
import {
  actionOutcomeContractsSchema,
  buildOutcomeMeasurementPlan,
} from "../../src/action_outcomes/index.js";

const primary = {
  outcomeId: "outcome.contribution_profit",
  role: "PRIMARY" as const,
  metricRef: "metric.contribution_profit",
  metricFamily: "CONTRIBUTION_PROFIT" as const,
  target: { kind: "GLOBAL" as const },
  valueType: { kind: "MONEY" as const, currency: "CAD" },
  comparison: { kind: "NONE" as const },
  successCondition: {
    kind: "ABSOLUTE_THRESHOLD" as const,
    comparator: "GTE" as const,
    threshold: { valueType: "MONEY" as const, amountMinor: 1, currency: "CAD" },
  },
  horizon: { amount: 30, unit: "DAY" as const, anchor: "ACTION_EFFECTIVE" as const },
  evidencePolicyRef: "evidence.policy.incrementality",
  sourceDefinitionRef: {
    registryRef: "metric.registry",
    code: "contribution_profit",
    version: "1",
  },
  decisionLedger: {
    outcomeKey: "decision.outcome.contribution_profit",
    evidenceSlotRef: "decision.evidence.contribution_profit",
  },
  learning: {
    signalRef: "learning.signal.contribution_profit",
    updateRuleRef: "learning.rule.observed_increment",
  },
};

const secondary = {
  ...primary,
  outcomeId: "outcome.incremental_customers",
  role: "SECONDARY" as const,
  metricRef: "metric.incremental_customers",
  metricFamily: "INCREMENTAL_CUSTOMERS" as const,
  valueType: { kind: "QUANTITY" as const, unit: "customers" as const },
  comparison: { kind: "CONTROL" as const, controlRef: "control.holdout" },
  successCondition: {
    kind: "CHANGE" as const,
    direction: "INCREASE" as const,
    minimumMagnitude: {
      valueType: "QUANTITY" as const,
      value: 1,
      unit: "customers",
    },
  },
  decisionLedger: {
    outcomeKey: "decision.outcome.incremental_customers",
    evidenceSlotRef: "decision.evidence.incremental_customers",
  },
  learning: {
    signalRef: "learning.signal.incremental_customers",
    updateRuleRef: "learning.rule.observed_increment",
  },
};

describe("Action measurable outcome contracts", () => {
  it("defines one primary outcome with a typed success rule and measurement horizon", () => {
    const parsed = actionOutcomeContractsSchema.parse([primary, secondary]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.role).toBe("PRIMARY");
    expect(parsed[0]?.horizon).toEqual({
      amount: 30,
      unit: "DAY",
      anchor: "ACTION_EFFECTIVE",
    });
  });

  it("builds a deterministic Decision Ledger and Learning measurement plan", () => {
    const first = buildOutcomeMeasurementPlan(
      "action_example",
      "fnv1a64:0123456789abcdef",
      [secondary, primary],
    );
    const second = buildOutcomeMeasurementPlan(
      "action_example",
      "fnv1a64:0123456789abcdef",
      [primary, secondary],
    );
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.outcomeId)).toEqual([
      "outcome.contribution_profit",
      "outcome.incremental_customers",
    ]);
    expect(first.entries[0]).toMatchObject({
      decisionLedgerOutcomeKey: "decision.outcome.contribution_profit",
      learningSignalRef: "learning.signal.contribution_profit",
    });
  });

  it("requires exactly one PRIMARY outcome", () => {
    expect(actionOutcomeContractsSchema.safeParse([{ ...primary, role: "SECONDARY" }]).success).toBe(false);
    expect(actionOutcomeContractsSchema.safeParse([primary, { ...secondary, role: "PRIMARY" }]).success).toBe(false);
  });

  it("rejects impossible success-condition typing and unbound change comparisons", () => {
    expect(actionOutcomeContractsSchema.safeParse([{
      ...primary,
      successCondition: {
        kind: "ABSOLUTE_THRESHOLD",
        comparator: "GTE",
        threshold: { valueType: "PERCENTAGE", basisPoints: 100 },
      },
    }]).success).toBe(false);

    expect(actionOutcomeContractsSchema.safeParse([{
      ...secondary,
      comparison: { kind: "NONE" },
    }]).success).toBe(false);

    expect(actionOutcomeContractsSchema.safeParse([{
      ...primary,
      valueType: { kind: "SCALAR", unitRef: "ratio.points" },
      successCondition: {
        kind: "ABSOLUTE_THRESHOLD",
        comparator: "GTE",
        threshold: { valueType: "SCALAR", value: 1, unit: "ratio.other" },
      },
    }]).success).toBe(false);
  });

  it("rejects observed results and hidden evaluator or God-mode references", () => {
    expect(actionOutcomeContractsSchema.safeParse([{
      ...primary,
      groundTruth: { value: 999 },
    }]).success).toBe(false);

    expect(actionOutcomeContractsSchema.safeParse([{
      ...primary,
      sourceDefinitionRef: {
        registryRef: "ground_truth.metrics",
        code: "profit",
        version: "1",
      },
    }]).success).toBe(false);
  });

  it("requires unique outcome and Decision Ledger identities", () => {
    expect(actionOutcomeContractsSchema.safeParse([
      primary,
      { ...secondary, outcomeId: primary.outcomeId },
    ]).success).toBe(false);
    expect(actionOutcomeContractsSchema.safeParse([
      primary,
      {
        ...secondary,
        decisionLedger: {
          ...secondary.decisionLedger,
          outcomeKey: primary.decisionLedger.outcomeKey,
        },
      },
    ]).success).toBe(false);
  });
});
