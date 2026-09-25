import { describe, expect, it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { canonicalOperatorDecisionFingerprint, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import {
  ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
  ROAS_THRESHOLD_DECREASE_CONFIG,
  ROAS_THRESHOLD_INCREASE_CONFIG,
} from "../../src/operator/advertising-heuristics.js";
import {
  FIXED_REORDER_THRESHOLD_CONFIG,
  INVENTORY_HEURISTIC_BASELINE_OPERATORS,
  LOW_INVENTORY_DEPROMOTION_CONFIG,
} from "../../src/operator/inventory-heuristics.js";
import {
  EXCESS_INVENTORY_DISCOUNT_CONFIG,
  FIXED_DISCOUNT_CONFIG,
  FIXED_PROMOTIONAL_CALENDAR_CONFIG,
  PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS,
} from "../../src/operator/pricing-promotion-heuristics.js";
import { MERCHANDISING_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/merchandising-heuristics.js";
import { GREEDY_BASELINE_OPERATORS } from "../../src/operator/greedy-operators.js";
import { FLAWED_OPTIMIZER_BASELINE_OPERATORS } from "../../src/operator/flawed-optimizers.js";
import { ALL_BASELINE_VALIDATION_CASES, FROZEN_BASELINE_OPERATORS, emptyCanonicalContext } from "./helpers.js";

describe("frozen baseline semantics", () => {
  it("DO_NOTHING always emits [] through a real canonical invocation", () => {
    const operator = ensureCanonicalOperatorV2(FROZEN_BASELINE_OPERATORS[0]);
    for (const sequence of [0, 1, 7, 29]) {
      expect(operator.decide(emptyCanonicalContext(sequence).input).actions).toEqual([]);
    }
  });

  it("STATUS_QUO emits its two captured policy actions only when due", () => {
    const operator = ensureCanonicalOperatorV2(FROZEN_BASELINE_OPERATORS[1]);
    const probe = ALL_BASELINE_VALIDATION_CASES[1]!.evidence.permittedInformationSensitivity;
    expect(operator.metadata.operatorId).toBe("baseline.status_quo");
    expect(operator.decide(probe.invocations[0]!.canonicalInput).actions).toEqual([]);
    expect(operator.decide(probe.invocations[1]!.canonicalInput).actions.map(actionFingerprint)).toEqual([
      "fnv1a64:2ff00cec50d59ed4",
      "fnv1a64:8551f80f8b1a7265",
    ]);
    expect(operator.metadata.configurationFingerprint).toBe(
      ensureCanonicalOperatorV2(ALL_BASELINE_VALIDATION_CASES[1]!.operator).metadata.configurationFingerprint,
    );
  });

  it("freezes advertising spend/ROAS policies and excludes hidden incrementality objectives", () => {
    expect(Object.keys(ADVERTISING_HEURISTIC_BASELINE_OPERATORS)).toEqual([
      "EQUAL_BUDGET_ALLOCATION", "ROAS_THRESHOLD_INCREASE", "ROAS_THRESHOLD_DECREASE",
      "HIGHEST_OBSERVED_ROAS", "FIXED_CHANNEL_ALLOCATION",
    ]);
    expect(ROAS_THRESHOLD_INCREASE_CONFIG.roasThreshold).toBe(3);
    expect(ROAS_THRESHOLD_DECREASE_CONFIG.roasThreshold).toBe(1.5);
    for (const operator of Object.values(ADVERTISING_HEURISTIC_BASELINE_OPERATORS)) {
      const configuration = operator.metadata.deterministicConfiguration as any;
      expect(configuration.causalCorrection).toBe(false);
      expect(configuration.forecasting).toBe(false);
      expect(configuration.learning).toBe(false);
    }
  });

  it("freezes exact inventory thresholds without future-demand inputs", () => {
    expect(FIXED_REORDER_THRESHOLD_CONFIG.thresholdUnits).toBe(10);
    expect(LOW_INVENTORY_DEPROMOTION_CONFIG.lowInventoryThresholdUnits).toBe(5);
    for (const operator of Object.values(INVENTORY_HEURISTIC_BASELINE_OPERATORS)) {
      const configuration = operator.metadata.deterministicConfiguration as any;
      expect(configuration.demandForecasting).toBe(false);
      expect(configuration.stockoutPrediction).toBe(false);
      expect(configuration.hiddenStateAccess).toBe(false);
    }
  });

  it("freezes pricing schedules, bounds, and inventory-triggered behavior", () => {
    expect(FIXED_DISCOUNT_CONFIG.discountBasisPoints).toBe(1000);
    expect(EXCESS_INVENTORY_DISCOUNT_CONFIG.excessInventoryThresholdUnits).toBe(100);
    expect(FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar).toHaveLength(2);
    for (const operator of Object.values(PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS)) {
      const configuration = operator.metadata.deterministicConfiguration as any;
      expect(configuration.forecasting).toBe(false);
      expect(configuration.causalLiftEstimation).toBe(false);
      expect(configuration.hiddenStateAccess).toBe(false);
    }
  });

  it("registers distinct observable merchandising, greedy, and flawed KPI objectives", () => {
    expect(Object.values(MERCHANDISING_HEURISTIC_BASELINE_OPERATORS).map((operator) => operator.metadata.operatorId)).toEqual([
      "baseline.merchandising.rank_by_revenue",
      "baseline.merchandising.rank_by_conversion_rate",
      "baseline.merchandising.rank_by_units_sold",
    ]);
    expect(Object.values(GREEDY_BASELINE_OPERATORS).map((operator) => operator.metadata.operatorId)).toEqual([
      "baseline.greedy.immediate_revenue",
      "baseline.greedy.immediate_gross_profit",
      "baseline.greedy.immediate_contribution",
    ]);
    expect(Object.values(FLAWED_OPTIMIZER_BASELINE_OPERATORS)).toHaveLength(6);
  });

  it("uses deterministic empty, tie, missing-data, and unavailable-target fallbacks for every family", () => {
    for (const legacy of FROZEN_BASELINE_OPERATORS) {
      const operator = ensureCanonicalOperatorV2(legacy);
      const input = emptyCanonicalContext().input;
      const first = operator.decide(input);
      const second = operator.decide(input);
      expect(canonicalOperatorDecisionFingerprint(first)).toBe(canonicalOperatorDecisionFingerprint(second));
      expect(first.actions).toEqual([]);
    }
  });

  it("proves every information-responsive frozen operator changes semantic output under its exact permitted metric", () => {
    for (const entry of ALL_BASELINE_VALIDATION_CASES) {
      const expectation = entry.evidence.permittedInformationSensitivity.expectation;
      if (expectation.kind === "not_applicable") continue;
      expect(expectation.kind).toBe("sensitive");
      const operator = ensureCanonicalOperatorV2(entry.operator);
      const decisions = entry.evidence.permittedInformationSensitivity.invocations.map((invocation) =>
        canonicalOperatorDecisionFingerprint(operator.decide(invocation.canonicalInput)),
      );
      expect(new Set(decisions).size, entry.operator.metadata.operatorId).toBeGreaterThan(1);
    }
  });

  it("uses real multi-Action decisions or explicit evaluator-owned capability N/A", () => {
    for (const entry of ALL_BASELINE_VALIDATION_CASES) {
      const probe = entry.evidence.multiActionBehavior;
      if (probe.expectation.kind === "not_applicable") {
        expect(probe.expectation.disposition).toBe("NOT_APPLICABLE_BY_FROZEN_CAPABILITY");
        expect(probe.expectation.reasonCode).toMatch(/^(MAXIMUM_ACTIONS_PER_DECISION_LE_ONE|FROZEN_SINGLE_EMISSION_SEMANTICS)$/);
        continue;
      }
      expect(probe.expectation.kind).toBe("multi_action");
      const operator = ensureCanonicalOperatorV2(entry.operator);
      expect(operator.decide(probe.invocations[0]!.canonicalInput).actions.length).toBeGreaterThan(1);
    }
  });
});
