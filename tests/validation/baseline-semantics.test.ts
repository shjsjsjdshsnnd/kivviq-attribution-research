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

  it("covers advertising missing metrics, zero spend, insufficient/new history, and legally unavailable channels", () => {
    const probes = ALL_BASELINE_VALIDATION_CASES.slice(2, 7).map((entry) => entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput);
    const channels = probes.map((input) => (input.observation.records[0]!.value as any).channels);
    expect(probes[0]!.legalActionSpace.rules[0]!.eligibleTargets).toEqual([{ kind: "advertising_channel", channelId: "tiktok_ads" }]);
    expect(channels[1][0]).toMatchObject({ spendMinor: null, attributedRevenueMinor: null });
    expect(channels[2][0]).toMatchObject({ spendMinor: 0, attributedRevenueMinor: 0 });
    expect(channels[3].every((channel: any) => channel.historyDays === 0)).toBe(true);
    expect(probes[4]!.legalActionSpace.rules[0]!.eligibleTargets).toHaveLength(2);
  });

  it("covers inventory 9/10/11 boundaries, missing inventory, and unavailable SKUs", () => {
    const threshold = ALL_BASELINE_VALIDATION_CASES[7]!;
    const units = [...threshold.evidence.permittedInformationSensitivity.invocations, ...threshold.evidence.tieBreaking.invocations].map((invocation) => ((invocation.canonicalInput.observation.records[0]!.value as any).skus[0].availableUnits));
    expect(new Set(units)).toEqual(new Set([9, 10, 11]));
    const missingSkus = ALL_BASELINE_VALIDATION_CASES.slice(7, 11).map((entry) => (entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any).skus[0]);
    expect(missingSkus.some((sku) => sku.availableUnits === null)).toBe(true);
    expect(missingSkus.some((sku) => sku.active === false)).toBe(true);
    const lowInventory = ALL_BASELINE_VALIDATION_CASES[9]!;
    expect((lowInventory.evidence.tieBreaking.invocations[0]!.canonicalInput.observation.records[0]!.value as any).skus[0].availableUnits).toBe(5);
  });

  it("covers exact equality at both strict advertising ROAS thresholds", () => {
    const increase = (ALL_BASELINE_VALIDATION_CASES[3]!.evidence.tieBreaking.invocations[0]!.canonicalInput.observation.records[0]!.value as any).channels[0];
    const decrease = (ALL_BASELINE_VALIDATION_CASES[4]!.evidence.tieBreaking.invocations[0]!.canonicalInput.observation.records[0]!.value as any).channels[0];
    expect(increase.attributedRevenueMinor / increase.spendMinor).toBe(3);
    expect(decrease.attributedRevenueMinor / decrease.spendMinor).toBe(1.5);
  });

  it("covers pricing and promotion missing/new SKUs, unavailable/ineligible targets, and schedule-boundary evidence", () => {
    const skus = ALL_BASELINE_VALIDATION_CASES.slice(11, 15).map((entry) => (entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any).skus[0]);
    expect(skus[0].currentPriceMinor).toBeNull();
    expect(skus[0].skuId).toBe("sku:NEW");
    expect(skus[1].active).toBe(false);
    expect(skus[2].observableInventoryUnits).toBeNull();
    expect(skus[3].promotionEligible).toBe(false);
    expect(FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar.map((entry) => entry.startAt)).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-07T00:00:00.000Z"]);
  });

  it("covers merchandising missing metrics, zero denominators, insufficient views, new products, and unavailable targets", () => {
    const products = ALL_BASELINE_VALIDATION_CASES.slice(15, 18).map((entry) => (entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any).products);
    expect(products[0].some((product: any) => product.revenueMinor === null)).toBe(true);
    expect(products[0].some((product: any) => product.available === false)).toBe(true);
    expect(products[1].some((product: any) => product.productViews === 0)).toBe(true);
    expect(products[1].some((product: any) => product.productViews > 0 && product.productViews < 20)).toBe(true);
    expect(products[2].some((product: any) => product.newlyLaunched && product.unitsSold === null)).toBe(true);
  });

  it("covers greedy and flawed missing objectives, zero ROAS/CAC/CPA denominators, and insufficient evidence", () => {
    const greedy = ALL_BASELINE_VALIDATION_CASES.slice(18, 21).map((entry) => (entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any).channels);
    const greedyPayloads = ALL_BASELINE_VALIDATION_CASES.slice(18, 21).map((entry) => entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any);
    expect(greedyPayloads.every((payload) => payload.lookbackDays === 0)).toBe(true);
    expect(greedy[0].every((channel: any) => channel.attributedRevenueMinor === null)).toBe(true);
    expect(greedy[1].every((channel: any) => channel.attributedGrossProfitMinor === null)).toBe(true);
    expect(greedy[2].every((channel: any) => channel.attributedContributionMinor === null)).toBe(true);
    const flawed = ALL_BASELINE_VALIDATION_CASES.slice(21, 27).map((entry) => (entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.observation.records[0]!.value as any));
    expect(flawed.every((payload) => payload.lookbackDays === 0)).toBe(true);
    expect(flawed[0].channels.every((channel: any) => channel.spendMinor === 0)).toBe(true);
    expect(flawed[1].channels.every((channel: any) => channel.representedNewCustomers === 0)).toBe(true);
    expect(flawed[4].channels.every((channel: any) => channel.representedPurchaseConversions === 0)).toBe(true);
    expect(flawed[5].products.every((product: any) => product.productViews === 0)).toBe(true);
  });

  it("uses actual equal-score observations for responsive family tie probes", () => {
    for (const entry of [...ALL_BASELINE_VALIDATION_CASES.slice(5, 6), ...ALL_BASELINE_VALIDATION_CASES.slice(15, 27)]) {
      const input = entry.evidence.tieBreaking.invocations[0]!.canonicalInput;
      const value = input.observation.records[0]!.value as any;
      const candidates = value.channels ?? value.products;
      expect(candidates).toHaveLength(2);
      const id = entry.operator.metadata.operatorId;
      if (id.endsWith("highest_observed_roas") || id.endsWith("max_roas")) expect(value.channels.map((channel: any) => channel.attributedRevenueMinor / channel.spendMinor)).toEqual([2, 2]);
      else if (id.endsWith("min_cac")) expect(value.channels.map((channel: any) => channel.spendMinor / channel.representedNewCustomers)).toEqual([20_000, 20_000]);
      else if (id.endsWith("lowest_cpa")) expect(value.channels.map((channel: any) => channel.spendMinor / channel.representedPurchaseConversions)).toEqual([10_000, 10_000]);
      else if (id.includes("merchandising.rank_by_revenue")) expect(value.products.map((product: any) => product.revenueMinor)).toEqual([20, 20]);
      else if (id.includes("rank_by_conversion_rate") || id.endsWith("highest_conversion_rate")) expect(value.products.map((product: any) => product.conversions / product.productViews)).toEqual([0.2, 0.2]);
      else if (id.includes("rank_by_units_sold") || id.endsWith("best_seller_push")) expect(value.products.map((product: any) => product.unitsSold)).toEqual([20, 20]);
      else if (id.endsWith("immediate_revenue")) expect(value.channels.map((channel: any) => channel.attributedRevenueMinor)).toEqual([200_000, 200_000]);
      else if (id.endsWith("immediate_gross_profit")) expect(value.channels.map((channel: any) => channel.attributedGrossProfitMinor)).toEqual([200_000, 200_000]);
      else if (id.endsWith("immediate_contribution")) expect(value.channels.map((channel: any) => channel.attributedContributionMinor)).toEqual([200_000, 200_000]);
      else if (id.endsWith("max_revenue")) expect(value.channels.map((channel: any) => channel.attributedRevenueMinor)).toEqual([200_000, 200_000]);
      const operator = ensureCanonicalOperatorV2(entry.operator);
      const actions = operator.decide(input).actions.map(actionFingerprint);
      const expectation = entry.evidence.tieBreaking.expectation;
      expect(expectation.kind).toBe("exact");
      if (expectation.kind === "exact") expect(actions).toEqual(expectation.expectedActionFingerprints[0]);
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
