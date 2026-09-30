import { describe, expect, it } from "vitest";
import {
  OUTCOME_LEDGER_LEARNING_BRIDGE_VERSION,
  buildOutcomeMeasurementBridge,
} from "../../src/action_outcomes/index.js";

function plan() {
  return {
    schemaVersion: 1 as const,
    outcomes: [
      {
        outcomeId: "profit.primary",
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

describe("Outcome Decision Ledger and Learning bridge", () => {
  it("projects a deterministic bridge regardless of authored outcome order", () => {
    const owner = {
      kind: "ACTION" as const,
      actionId: "action_measurement_bridge",
      actionFingerprint: "fnv1a64:0123456789abcdef",
    };
    const first = buildOutcomeMeasurementBridge(owner, plan());
    const reordered = plan();
    reordered.outcomes.reverse();
    const second = buildOutcomeMeasurementBridge(owner, reordered);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(OUTCOME_LEDGER_LEARNING_BRIDGE_VERSION);
    expect(first.entries.map(({ outcomeId }) => outcomeId)).toEqual([
      "conversion.guardrail",
      "profit.primary",
    ]);
  });

  it("emits explicit stable Decision Ledger and Learning join keys", () => {
    const bridge = buildOutcomeMeasurementBridge(
      {
        kind: "ACTION",
        actionId: "action_measurement_bridge",
        actionFingerprint: "fnv1a64:0123456789abcdef",
      },
      plan(),
    );

    const profit = bridge.entries.find(
      ({ outcomeId }) => outcomeId === "profit.primary",
    )!;
    expect(profit.decisionLedger).toEqual({
      decisionKey:
        "decision:ACTION:action_measurement_bridge:fnv1a64:0123456789abcdef",
      outcomeKey:
        "outcome:ACTION:action_measurement_bridge:fnv1a64:0123456789abcdef:profit.primary",
      evidencePolicyRef: "evidence_policy.store_profit",
    });
    expect(profit.learning).toEqual({
      signalKey:
        "learning:ACTION:action_measurement_bridge:fnv1a64:0123456789abcdef:profit.primary:metric.contribution_profit",
      outcomeKey:
        "outcome:ACTION:action_measurement_bridge:fnv1a64:0123456789abcdef:profit.primary",
      metricRef: "metric.contribution_profit",
    });
    expect(profit.measurementWindow.primaryEvaluation).toEqual({
      amount: 14,
      unit: "DAY",
    });
  });

  it("supports the same bridge for compound-level measurable outcomes", () => {
    const bridge = buildOutcomeMeasurementBridge(
      {
        kind: "COMPOUND",
        compoundActionId: "compound_measurement_bridge",
        compoundFingerprint: "fnv1a64:fedcba9876543210",
      },
      plan(),
    );

    expect(bridge.owner.kind).toBe("COMPOUND");
    expect(bridge.entries[0]!.decisionLedger.decisionKey).toBe(
      "decision:COMPOUND:compound_measurement_bridge:fnv1a64:fedcba9876543210",
    );
  });

  it("rejects an invalid owner identity instead of creating unbound join keys", () => {
    expect(() =>
      buildOutcomeMeasurementBridge(
        {
          kind: "ACTION",
          actionId: "not-an-action",
          actionFingerprint: "fnv1a64:0123456789abcdef",
        } as any,
        plan(),
      ),
    ).toThrow();
  });
});
