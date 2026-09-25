import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { googleBudgetUp2000, metaBudgetDown2000 } from "../../src/action_translation/fixtures.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import {
  buildCanonicalOperatorInput,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import {
  canonicalInputFingerprint,
  ensureCanonicalOperatorV2,
} from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { ADVERTISING_HEURISTIC_BASELINE_OPERATORS, ADVERTISING_HEURISTIC_OBSERVATION_KEY, type AdvertisingChannelObservation } from "../../src/operator/advertising-heuristics.js";
import { INVENTORY_HEURISTIC_BASELINE_OPERATORS, INVENTORY_HEURISTIC_OBSERVATION_KEY, type InventorySkuObservation } from "../../src/operator/inventory-heuristics.js";
import { FIXED_PROMOTIONAL_CALENDAR_CONFIG, PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS, PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY, type PricingPromotionSkuObservation } from "../../src/operator/pricing-promotion-heuristics.js";
import { MERCHANDISING_HEURISTIC_BASELINE_OPERATORS, MERCHANDISING_HEURISTIC_OBSERVATION_KEY, type MerchandisingProductObservation } from "../../src/operator/merchandising-heuristics.js";
import { GREEDY_BASELINE_OPERATORS, GREEDY_OBSERVATION_KEY, type GreedyChannelObservation, type GreedyProductObservation } from "../../src/operator/greedy-operators.js";
import { FLAWED_OPTIMIZER_BASELINE_OPERATORS, FLAWED_OPTIMIZER_OBSERVATION_KEY, type FlawedChannelObservation, type FlawedProductObservation } from "../../src/operator/flawed-optimizers.js";
import { createMerchantPolicy } from "../../src/operator/merchant-policy.js";
import { createStatusQuoOperator } from "../../src/operator/status-quo.js";
import type { CanonicalOperator } from "../../src/operator/types.js";
import {
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  baselineValidationCaseFingerprint,
  canonicalProbeDecisionFingerprint,
  canonicalReplaySchemaFingerprint,
  createRecordedDecisionArtifact,
  declarativeProbeFingerprint,
  type BaselineValidationCase,
  type ExecutableConformanceProbe,
  type ProhibitedInformationProbe,
} from "../../src/validation/index.js";

const START = "2026-10-01T00:00:00.000Z";
const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;

function capturedStatusQuoOperator(): CanonicalOperator {
  const component = (domain: "advertising" | "pricing" | "promotions" | "merchandising" | "inventory") => ({
    domain,
    coverage: "undefined" as const,
    componentVersion: "1.0.0",
    sourceRef: `merchant-policy-fixture:empty:${domain}`,
    effectivePeriod: { start: START },
    parameters: { policyKind: "undefined" },
    rules: [],
  });
  return createStatusQuoOperator(createMerchantPolicy({
    policyId: "merchant-policy:empty-captured-policy-v1",
    policyVersion: "1.0.0",
    description: "Frozen captured policy with no operator-owned actions.",
    source: { sourceRef: "merchant-policy-fixture:empty", capturedAt: START, description: "Empty captured policy." },
    effectivePeriod: { start: START },
    components: {
      advertising: {
        ...component("advertising"), coverage: "defined" as const,
        parameters: { policyKind: "captured_observation_trigger" },
        rules: [{
          kind: "observation_triggered_action" as const,
          ruleId: "advertising.captured_budget_trigger",
          domain: "advertising" as const,
          behaviorKey: "advertising.google_budget_trigger",
          description: "Captured budget rule.", version: "1.0.0", sourceRef: "merchant-policy-fixture:captured",
          effectivePeriod: { start: START }, ownership: "operator_owned" as const,
          cadence: "every_decision_while_true" as const,
          observationKey: "status_quo.captured_signal", observationValuePath: "value",
          comparison: "GTE" as const, threshold: 1,
          actionPrototype: googleBudgetUp2000,
          simulatorCompatibility: "supported_by_frozen_translation" as const,
        }, {
          kind: "observation_triggered_action" as const,
          ruleId: "advertising.captured_meta_budget_trigger",
          domain: "advertising" as const,
          behaviorKey: "advertising.meta_budget_trigger",
          description: "Second captured budget rule.", version: "1.0.0", sourceRef: "merchant-policy-fixture:captured",
          effectivePeriod: { start: START }, ownership: "operator_owned" as const,
          cadence: "every_decision_while_true" as const,
          observationKey: "status_quo.captured_signal", observationValuePath: "value",
          comparison: "GTE" as const, threshold: 1,
          actionPrototype: metaBudgetDown2000,
          simulatorCompatibility: "supported_by_frozen_translation" as const,
        }],
      },
      pricing: component("pricing"),
      promotions: component("promotions"),
      merchandising: component("merchandising"),
      inventory: component("inventory"),
    },
  }));
}

export const FROZEN_BASELINE_OPERATORS = Object.freeze([
  DO_NOTHING_OPERATOR,
  capturedStatusQuoOperator(),
  ...Object.values(ADVERTISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(INVENTORY_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(MERCHANDISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(GREEDY_BASELINE_OPERATORS),
  ...Object.values(FLAWED_OPTIMIZER_BASELINE_OPERATORS),
] as const);

export const FROZEN_BASELINE_OPERATOR_IDS = Object.freeze([
  "baseline.do_nothing",
  "baseline.status_quo",
  "baseline.advertising.equal_budget_allocation",
  "baseline.advertising.roas_threshold_increase",
  "baseline.advertising.roas_threshold_decrease",
  "baseline.advertising.highest_observed_roas",
  "baseline.advertising.fixed_channel_allocation",
  "baseline.inventory.fixed_reorder_threshold",
  "baseline.inventory.fixed_reorder_quantity",
  "baseline.inventory.low_inventory_depromotion",
  "baseline.inventory.no_inventory_aware_intervention",
  "baseline.pricing.never_discount",
  "baseline.pricing.fixed_discount",
  "baseline.pricing.excess_inventory_discount",
  "baseline.promotion.fixed_promotional_calendar",
  "baseline.merchandising.rank_by_revenue",
  "baseline.merchandising.rank_by_conversion_rate",
  "baseline.merchandising.rank_by_units_sold",
  "baseline.greedy.immediate_revenue",
  "baseline.greedy.immediate_gross_profit",
  "baseline.greedy.immediate_contribution",
  "baseline.flawed.max_roas",
  "baseline.flawed.min_cac",
  "baseline.flawed.max_revenue",
  "baseline.flawed.best_seller_push",
  "baseline.flawed.lowest_cpa",
  "baseline.flawed.highest_conversion_rate",
] as const);

/** Reviewed semantic Action fingerprints, fixed independently from runtime decisions. */
export const FROZEN_POLICY_ACTION_FINGERPRINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "baseline.do_nothing": [],
  "baseline.status_quo": ["fnv1a64:2ff00cec50d59ed4", "fnv1a64:8551f80f8b1a7265"],
  "baseline.advertising.equal_budget_allocation": ["fnv1a64:d9744b856ccf9bca", "fnv1a64:2392eb1aee63e315", "fnv1a64:bdc2e0985bd4f476"],
  "baseline.advertising.roas_threshold_increase": ["fnv1a64:1dcf6a09e5dc97a3"],
  "baseline.advertising.roas_threshold_decrease": ["fnv1a64:a28c4607c0cdf3a6"],
  "baseline.advertising.highest_observed_roas": ["fnv1a64:26be6c455b51cb51", "fnv1a64:97b9e1ac64dc2b62"],
  "baseline.advertising.fixed_channel_allocation": ["fnv1a64:691cabb0153de2dc", "fnv1a64:a31febc58979144f", "fnv1a64:86bc6cfd5e14a2c6"],
  "baseline.inventory.fixed_reorder_threshold": ["fnv1a64:857079e424472360"],
  "baseline.inventory.fixed_reorder_quantity": ["fnv1a64:cd3e829b18115349"],
  "baseline.inventory.low_inventory_depromotion": ["fnv1a64:ac4dee6f7593dd5d"],
  "baseline.inventory.no_inventory_aware_intervention": [],
  "baseline.pricing.never_discount": ["fnv1a64:b4cf67f8b9dffc9b"],
  "baseline.pricing.fixed_discount": ["fnv1a64:7fec07aeef73c8b9"],
  "baseline.pricing.excess_inventory_discount": ["fnv1a64:8512390cb995b1da"],
  "baseline.promotion.fixed_promotional_calendar": ["fnv1a64:db5bee3db98c83a2"],
  "baseline.merchandising.rank_by_revenue": ["fnv1a64:099fb13ace1f3b1c", "fnv1a64:011b253dd003d309", "fnv1a64:2f5938142b67f25f"],
  "baseline.merchandising.rank_by_conversion_rate": ["fnv1a64:099fb13ace1f3b1c", "fnv1a64:011b253dd003d309", "fnv1a64:2f5938142b67f25f"],
  "baseline.merchandising.rank_by_units_sold": ["fnv1a64:099fb13ace1f3b1c", "fnv1a64:011b253dd003d309", "fnv1a64:2f5938142b67f25f"],
  "baseline.greedy.immediate_revenue": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.greedy.immediate_gross_profit": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.greedy.immediate_contribution": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.max_roas": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.min_cac": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.max_revenue": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.best_seller_push": ["fnv1a64:81f218e7aa3acf04"],
  "baseline.flawed.lowest_cpa": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.highest_conversion_rate": ["fnv1a64:81f218e7aa3acf04"],
});

const FROZEN_TIE_ACTION_FINGERPRINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...Object.fromEntries(FROZEN_BASELINE_OPERATOR_IDS.map((id) => [id, []])),
  "baseline.advertising.highest_observed_roas": ["fnv1a64:1082a83449549fdf", "fnv1a64:ddf3caa13dc75a33"],
  "baseline.merchandising.rank_by_revenue": ["fnv1a64:0be701648238e236", "fnv1a64:3990b17eb8d7dc1a"],
  "baseline.merchandising.rank_by_conversion_rate": ["fnv1a64:0be701648238e236", "fnv1a64:3990b17eb8d7dc1a"],
  "baseline.merchandising.rank_by_units_sold": ["fnv1a64:0be701648238e236", "fnv1a64:3990b17eb8d7dc1a"],
  "baseline.greedy.immediate_revenue": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.greedy.immediate_gross_profit": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.greedy.immediate_contribution": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.max_roas": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.min_cac": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.max_revenue": ["fnv1a64:a88349e97c8808de"],
  "baseline.flawed.best_seller_push": ["fnv1a64:81f218e7aa3acf04"],
  "baseline.flawed.lowest_cpa": ["fnv1a64:4cc8e8cf891b3d79"],
  "baseline.flawed.highest_conversion_rate": ["fnv1a64:81f218e7aa3acf04"],
});

export function emptyCanonicalContext(sequence = 0) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  const legacyInput = toOperatorDecisionInput(opportunity, observation, availability);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, legacyInput);
  return { opportunity, observation, availability, input };
}

function canonicalContext(sequence: number, records: readonly any[], rules: readonly any[]) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, records.map((record) => ({
    ...record,
    sourceMinOccurredAt: record.sourceMinOccurredAt ?? opportunity.at,
    sourceMaxOccurredAt: record.sourceMaxOccurredAt ?? opportunity.at,
    availableAt: record.availableAt ?? opportunity.at,
  })));
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, rules);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
  return { opportunity, observation, availability, input };
}

function missingObservationContext(context: CanonicalContext): CanonicalContext {
  const observation = buildOperatorObservationSnapshot(contract, context.opportunity, []);
  const input = buildCanonicalOperatorInput(contract, context.opportunity, observation, context.availability, toOperatorDecisionInput(context.opportunity, observation, context.availability));
  return { opportunity: context.opportunity, observation, availability: context.availability, input };
}

function statusQuoContext(value: number) {
  return canonicalContext(0, [{ observationKey: "status_quo.captured_signal", informationClass: "current_state_information", sourceRef: "merchant-state:status-quo-fixture", value: { value } }], [
    { actionType: String(googleBudgetUp2000.actionType), eligibleTargets: [googleBudgetUp2000.target, metaBudgetDown2000.target], parameterBounds: [], requiredPreconditionIds: [] },
  ]);
}

function advertisingContext(channels: readonly AdvertisingChannelObservation[], sequence = 0, eligibleChannelIds = channels.map(({ channelId }) => channelId)) {
  return canonicalContext(sequence, [{ observationKey: ADVERTISING_HEURISTIC_OBSERVATION_KEY, informationClass: "derived_observable_metric", sourceRef: "platform-report:advertising-channel-metrics", value: { schemaVersion: "1.0.0", attributionSemantics: "operator_observed_attributed_revenue", budgetPeriod: "week", lookbackDays: 7, channels } }], [{ actionType: "advertising.adjust_budget", eligibleTargets: eligibleChannelIds.map((channelId) => ({ kind: "advertising_channel", channelId })), parameterBounds: [], requiredPreconditionIds: [] }]);
}
const adChannel = (channelId: string, currentBudgetMinor: number, roas: number | null, overrides: Partial<AdvertisingChannelObservation> = {}): AdvertisingChannelObservation => ({ channelId, active: true, currency: "CAD", currentBudgetMinor, spendMinor: roas === null ? null : 100_000, attributedRevenueMinor: roas === null ? null : roas * 100_000, historyDays: 7, ...overrides });

function inventoryContext(item: InventorySkuObservation, sequence = 0) {
  return canonicalContext(sequence, [{ observationKey: INVENTORY_HEURISTIC_OBSERVATION_KEY, informationClass: "current_state_information", sourceRef: "inventory-ledger:step3.5-inventory-state", value: { schemaVersion: "1.0.0", availabilityConcept: "AVAILABLE_TO_SELL", skus: [item] } }], [
    { actionType: "inventory.reorder", eligibleTargets: [{ kind: "sku", productId: item.productId, skuId: item.skuId }], parameterBounds: [], requiredPreconditionIds: [] },
    { actionType: "promotion.stop", eligibleTargets: [{ kind: "promotion", promotionId: "promo_collection_x_auto_15" }], parameterBounds: [], requiredPreconditionIds: [] },
  ]);
}
const inventorySku = (overrides: Partial<InventorySkuObservation> = {}): InventorySkuObservation => ({ skuId: "sku:B", productId: "product:B", active: true, discontinued: false, availableUnits: 20, incomingUnits: 0, pendingReorder: false, observableReorderTriggered: false, existingReorderQuantityUnits: 50, supplierAvailable: true, activePromotionIds: ["promo_collection_x_auto_15"], ...overrides });

function pricingContext(item: PricingPromotionSkuObservation, sequence: number) {
  return canonicalContext(sequence, [{ observationKey: PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY, informationClass: "current_state_information", sourceRef: "commerce-ledger:step3.6-pricing-promotion-state", value: { schemaVersion: "1.0.0", timezone: "UTC", skus: [item] } }], [
    { actionType: "pricing.adjust_price", eligibleTargets: [{ kind: "sku", productId: "product:A", skuId: "sku:A" }], parameterBounds: [], requiredPreconditionIds: [] },
    { actionType: "promotion.start", eligibleTargets: FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar.map(({ promotionId }) => ({ kind: "promotion", promotionId })), parameterBounds: [], requiredPreconditionIds: [] },
  ]);
}
const pricingSku = (overrides: Partial<PricingPromotionSkuObservation> = {}): PricingPromotionSkuObservation => ({ skuId: "sku:A", productId: "product:A", active: true, excluded: false, promotionEligible: true, currency: "CAD", currentPriceMinor: 89_900, regularPriceMinor: 89_900, currentDiscountBasisPoints: 0, currentDiscountOwner: "none", observableInventoryUnits: 50, activePromotionIds: [], promotionOwners: {}, activeHeuristicRuleIds: [], heuristicRuleStartedAt: {}, ...overrides });

function merchandisingContext(products: readonly MerchandisingProductObservation[], sequence = 0) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const windowStart = new Date(Date.parse(opportunity.at) - 30 * 86400000).toISOString();
  return canonicalContext(sequence, [{ observationKey: MERCHANDISING_HEURISTIC_OBSERVATION_KEY, informationClass: "historical_information", sourceMinOccurredAt: windowStart, sourceRef: "commerce-ledger:step3.7-product-performance", value: { schemaVersion: "1.0.0", targetCollectionId: "collection:X", currency: "CAD", lookbackDays: 30, windowStart, windowEnd: opportunity.at, products } }], [{ actionType: "merchandising.move_product", eligibleTargets: products.map(({ productId }) => ({ kind: "product", productId })), parameterBounds: [], requiredPreconditionIds: [] }]);
}
const merchProduct = (productId: string, currentPosition: number, score: number, overrides: Partial<MerchandisingProductObservation> = {}): MerchandisingProductObservation => ({ productId, collectionMember: true, active: true, available: true, merchandisingEligible: true, excluded: false, currentPosition, pinnedPosition: null, mandatoryPosition: null, newlyLaunched: false, revenueMinor: score, conversions: score, productViews: 100, unitsSold: score, ...overrides });

function greedyContext(channels: readonly GreedyChannelObservation[], sequence = 0, lookbackDays = 7) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const windowStart = new Date(Date.parse(opportunity.at) - lookbackDays * 86400000).toISOString();
  return canonicalContext(sequence, [{ observationKey: GREEDY_OBSERVATION_KEY, informationClass: "historical_information", sourceMinOccurredAt: windowStart, sourceRef: "historical-observable:step3.8-greedy-evidence", value: { schemaVersion: "1.0.0", currency: "CAD", lookbackDays, windowStart, windowEnd: opportunity.at, channels, products: [] } }], [{ actionType: "advertising.adjust_budget", eligibleTargets: channels.map(({ channelId }) => ({ kind: "advertising_channel", channelId })), parameterBounds: [], requiredPreconditionIds: [] }]);
}
const greedyChannel = (channelId: string, revenue: number, grossProfit: number, contribution: number): GreedyChannelObservation => ({ channelId, active: true, currentBudgetMinor: 500_000, spendMinor: 100_000, attributedRevenueMinor: revenue, attributedGrossProfitMinor: grossProfit, attributedContributionMinor: contribution });

function flawedContext(channels: readonly FlawedChannelObservation[], products: readonly FlawedProductObservation[], sequence = 0, lookbackDays = 7) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const windowStart = new Date(Date.parse(opportunity.at) - lookbackDays * 86400000).toISOString();
  return canonicalContext(sequence, [{ observationKey: FLAWED_OPTIMIZER_OBSERVATION_KEY, informationClass: "historical_information", sourceMinOccurredAt: windowStart, sourceRef: "historical-observable:step3.9-flawed-kpi-evidence", value: { schemaVersion: "1.0.0", currency: "CAD", lookbackDays, windowStart, windowEnd: opportunity.at, channels, products } }], [
    { actionType: "advertising.adjust_budget", eligibleTargets: channels.map(({ channelId }) => ({ kind: "advertising_channel", channelId })), parameterBounds: [], requiredPreconditionIds: [] },
    { actionType: "merchandising.move_product", eligibleTargets: products.map(({ productId }) => ({ kind: "product", productId })), parameterBounds: [], requiredPreconditionIds: [] },
    { actionType: "promotion.start", eligibleTargets: products.map(({ productId }) => ({ kind: "promotion", promotionId: `promo_flawed_${productId === "product:A" ? "product_a" : "product_b"}_10pct` })), parameterBounds: [], requiredPreconditionIds: [] },
    { actionType: "pricing.adjust_price", eligibleTargets: products.map(({ productId, skuId }) => ({ kind: "sku", productId, skuId })), parameterBounds: [], requiredPreconditionIds: [] },
  ]);
}
const flawedChannel = (channelId: string, revenue: number, customers: number, conversions: number): FlawedChannelObservation => ({ channelId, active: true, currentBudgetMinor: 500_000, spendMinor: 100_000, attributedRevenueMinor: revenue, representedNewCustomers: customers, representedPurchaseConversions: conversions });
const flawedProduct = (productId: string, score: number): FlawedProductObservation => ({ productId, skuId: productId === "product:A" ? "sku:A" : "sku:B", collectionId: "collection:X", active: true, available: true, promotionEligible: true, merchandisingEligible: true, currentPriceMinor: productId === "product:A" ? 10_000 : 20_000, recentUnits: score, revenueMinor: score * 10_000, unitsSold: score, conversions: score, productViews: 100, currentPosition: productId === "product:A" ? 2 : 3 });

function executableProbe(
  operator: ReturnType<typeof ensureCanonicalOperatorV2>,
  caseId: string,
  checkId: ExecutableConformanceProbe["checkId"],
  fixtureId: string,
  inputs: readonly ReturnType<typeof emptyCanonicalContext>["input"][],
  expectation: ExecutableConformanceProbe["expectation"],
  primaryInputFingerprint: string,
): ExecutableConformanceProbe {
  const body = {
    probeId: `${caseId}:${checkId}`,
    checkId,
    operatorId: operator.metadata.operatorId,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId),
    primaryInputFingerprint,
    invocations: inputs.map((canonicalInput) => ({
      fixtureId,
      canonicalInput,
      inputFingerprint: canonicalInputFingerprint(canonicalInput),
    })),
    expectation,
  };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

function familyWitnesses(operatorId: string) {
  const hidden = operatorId.startsWith("baseline.advertising.")
    ? [{ hiddenIncrementalRoas: 0, causalIncrementalityEffectBasisPoints: -500 }, { hiddenIncrementalRoas: 8, causalIncrementalityEffectBasisPoints: 2_000 }]
    : operatorId.startsWith("baseline.inventory.")
      ? [{ hiddenSupplierLeadTimeDays: 30, hiddenStockoutCostMinor: 50_000 }, { hiddenSupplierLeadTimeDays: 1, hiddenStockoutCostMinor: 100 }]
      : operatorId.startsWith("baseline.pricing.") || operatorId.startsWith("baseline.promotion.")
        ? [{ marginMinor: 100, causalPromotionLiftBasisPoints: -500 }, { marginMinor: -200, causalPromotionLiftBasisPoints: 2_000 }]
        : operatorId.startsWith("baseline.merchandising.")
          ? [{ marginMinor: 100, causalPlacementEffectBasisPoints: -100 }, { marginMinor: -200, causalPlacementEffectBasisPoints: 900 }]
          : operatorId.startsWith("baseline.greedy.")
            ? [{ marginMinor: 100, causalChannelEffectMinor: -1_000 }, { marginMinor: -200, causalChannelEffectMinor: 20_000 }]
            : operatorId.startsWith("baseline.flawed.")
              ? [{ clvMinor: 500, marginMinor: 100, causalEffectBasisPoints: -500 }, { clvMinor: 50_000, marginMinor: -200, causalEffectBasisPoints: 2_000 }]
              : [{ causalPolicyEffectMinor: -1_000, hiddenCounterfactualProfitMinor: 100 }, { causalPolicyEffectMinor: 20_000, hiddenCounterfactualProfitMinor: 50_000 }];
  const future = operatorId.startsWith("baseline.advertising.")
    ? [{ futureAttributedRevenueMinor: 100_000 }, { futureAttributedRevenueMinor: 10_000_000 }]
    : operatorId.startsWith("baseline.inventory.")
      ? [{ futureDemandUnits: 10 }, { futureDemandUnits: 10_000 }]
      : operatorId.startsWith("baseline.pricing.") || operatorId.startsWith("baseline.promotion.")
        ? [{ futureDemandUnits: 10, futurePromotionRevenueMinor: 100 }, { futureDemandUnits: 10_000, futurePromotionRevenueMinor: 50_000 }]
        : operatorId.startsWith("baseline.merchandising.")
          ? [{ futureConversionBasisPoints: 100 }, { futureConversionBasisPoints: 2_000 }]
          : operatorId.startsWith("baseline.greedy.")
            ? [{ futureContributionMinor: 100, delayedOutcomeMinor: -1_000 }, { futureContributionMinor: 50_000, delayedOutcomeMinor: 20_000 }]
            : operatorId.startsWith("baseline.flawed.")
              ? [{ futureConversionBasisPoints: 100, futureClvMinor: 500 }, { futureConversionBasisPoints: 2_000, futureClvMinor: 50_000 }]
              : [{ futurePolicyOutcomeMinor: 100 }, { futurePolicyOutcomeMinor: 50_000 }];
  return { hidden: hidden as unknown as readonly [object, object], future: future as unknown as readonly [object, object] } as const;
}

function prohibitedProbe(operator: ReturnType<typeof ensureCanonicalOperatorV2>, caseId: string, input: ReturnType<typeof emptyCanonicalContext>["input"]): ProhibitedInformationProbe {
  const witnesses = familyWitnesses(operator.metadata.operatorId);
  const leftWitness = { ...witnesses.hidden[0], ...witnesses.future[0] };
  const rightWitness = { ...witnesses.hidden[1], ...witnesses.future[1] };
  const body = {
    probeId: `${caseId}:prohibited`,
    checkId: "prohibited_information_invariance" as const,
    operatorId: operator.metadata.operatorId,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId),
    primaryInputFingerprint: canonicalInputFingerprint(input),
    pairs: [{
      pairId: `${caseId}:hidden-future`,
      leftFixtureId: "hidden_truth_pair",
      rightFixtureId: "future_pair",
      leftInput: input,
      rightInput: input,
      leftWitness,
      rightWitness,
      leftWitnessFingerprint: evaluationFingerprint(leftWitness),
      rightWitnessFingerprint: evaluationFingerprint(rightWitness),
    }],
  };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

type CanonicalContext = ReturnType<typeof emptyCanonicalContext>;
interface FamilyEvidenceInputs {
  readonly policy: CanonicalContext;
  readonly sensitivity: readonly [CanonicalContext, CanonicalContext] | null;
  readonly tie: CanonicalContext;
  readonly missing: CanonicalContext;
  readonly multi: CanonicalContext | null;
}

function familyEvidenceInputs(operatorId: string): FamilyEvidenceInputs {
  const empty = emptyCanonicalContext();
  if (operatorId === "baseline.do_nothing") return { policy: empty, sensitivity: null, tie: empty, missing: empty, multi: null };
  if (operatorId === "baseline.status_quo") {
    const noDue = statusQuoContext(0); const due = statusQuoContext(1);
    return { policy: due, sensitivity: [noDue, due], tie: noDue, missing: noDue, multi: due };
  }
  if (operatorId.startsWith("baseline.advertising.")) {
    const balanced = [adChannel("google_ads", 700_000, 4), adChannel("meta_ads", 200_000, 1), adChannel("pinterest_ads", 100_000, 2)];
    const swapped = [adChannel("google_ads", 300_000, 1), adChannel("meta_ads", 200_000, 4), adChannel("pinterest_ads", 100_000, 2)];
    let left = advertisingContext(balanced); let right = advertisingContext(swapped);
    if (operatorId.endsWith("equal_budget_allocation") || operatorId.endsWith("fixed_channel_allocation")) {
      right = advertisingContext([adChannel("google_ads", 300_000, 4), adChannel("meta_ads", 200_000, 1), adChannel("pinterest_ads", 100_000, 2)]);
    }
    if (operatorId.endsWith("roas_threshold_decrease")) {
      left = advertisingContext([adChannel("google_ads", 500_000, 1), adChannel("meta_ads", 500_000, 2)]);
      right = advertisingContext([adChannel("google_ads", 500_000, 2), adChannel("meta_ads", 500_000, 1)]);
    }
    const tie = operatorId.endsWith("roas_threshold_increase")
      ? advertisingContext([adChannel("google_ads", 500_000, 3)])
      : operatorId.endsWith("roas_threshold_decrease")
        ? advertisingContext([adChannel("google_ads", 500_000, 1.5)])
        : advertisingContext([adChannel("google_ads", 500_000, 2), adChannel("meta_ads", 500_000, 2)]);
    const multi = operatorId.endsWith("roas_threshold_increase")
      ? advertisingContext([adChannel("google_ads", 500_000, 4), adChannel("meta_ads", 500_000, 4)])
      : operatorId.endsWith("roas_threshold_decrease")
        ? advertisingContext([adChannel("google_ads", 500_000, 1), adChannel("meta_ads", 500_000, 1)])
        : left;
    const missing = operatorId.endsWith("equal_budget_allocation")
      ? advertisingContext(balanced, 0, ["tiktok_ads"])
      : operatorId.endsWith("roas_threshold_increase")
        ? advertisingContext([adChannel("google_ads", 500_000, null)])
        : operatorId.endsWith("roas_threshold_decrease")
          ? advertisingContext([adChannel("google_ads", 500_000, 1, { spendMinor: 0, attributedRevenueMinor: 0 })])
          : operatorId.endsWith("highest_observed_roas")
            ? advertisingContext([adChannel("google_ads", 500_000, 4, { historyDays: 0 }), adChannel("meta_ads", 500_000, 1, { historyDays: 0 })])
            : advertisingContext(balanced, 0, ["google_ads", "meta_ads"]);
    return { policy: left, sensitivity: [left, right], tie, missing, multi };
  }
  if (operatorId.startsWith("baseline.inventory.")) {
    if (operatorId.endsWith("no_inventory_aware_intervention")) { const policy = inventoryContext(inventorySku({ availableUnits: 9 })); return { policy, sensitivity: null, tie: empty, missing: inventoryContext(inventorySku({ active: false, availableUnits: null })), multi: null }; }
    if (operatorId.endsWith("fixed_reorder_quantity")) {
      const left = inventoryContext(inventorySku({ observableReorderTriggered: false })); const right = inventoryContext(inventorySku({ observableReorderTriggered: true }));
      return { policy: right, sensitivity: [left, right], tie: left, missing: inventoryContext(inventorySku({ active: false, observableReorderTriggered: true })), multi: null };
    }
    if (operatorId.endsWith("low_inventory_depromotion")) {
      const left = inventoryContext(inventorySku({ availableUnits: 6 })); const right = inventoryContext(inventorySku({ availableUnits: 4 }));
      return { policy: right, sensitivity: [left, right], tie: inventoryContext(inventorySku({ availableUnits: 5 })), missing: inventoryContext(inventorySku({ availableUnits: null })), multi: null };
    }
    const left = inventoryContext(inventorySku({ availableUnits: 11 })); const right = inventoryContext(inventorySku({ availableUnits: 9 }));
    return { policy: right, sensitivity: [left, right], tie: inventoryContext(inventorySku({ availableUnits: 10 })), missing: inventoryContext(inventorySku({ availableUnits: null })), multi: null };
  }
  if (operatorId.startsWith("baseline.pricing.") || operatorId.startsWith("baseline.promotion.")) {
    if (operatorId.endsWith("never_discount")) {
      const left = pricingContext(pricingSku(), 0); const right = pricingContext(pricingSku({ currentPriceMinor: 80_910, currentDiscountBasisPoints: 1000, currentDiscountOwner: "heuristic" }), 0);
      return { policy: right, sensitivity: [left, right], tie: left, missing: pricingContext(pricingSku({ skuId: "sku:NEW", productId: "product:NEW", currentPriceMinor: null }), 0), multi: null };
    }
    if (operatorId.endsWith("fixed_discount")) {
      const left = pricingContext(pricingSku({ activeHeuristicRuleIds: ["heuristic.fixed_discount.sku_a.v1"], heuristicRuleStartedAt: { "heuristic.fixed_discount.sku_a.v1": "2026-10-03T00:00:00.000Z" }, currentPriceMinor: 80_910, currentDiscountBasisPoints: 1000, currentDiscountOwner: "heuristic" }), 2); const right = pricingContext(pricingSku(), 2);
      return { policy: right, sensitivity: [left, right], tie: left, missing: pricingContext(pricingSku({ active: false }), 2), multi: null };
    }
    if (operatorId.endsWith("excess_inventory_discount")) {
      const left = pricingContext(pricingSku({ observableInventoryUnits: 100 }), 0); const right = pricingContext(pricingSku({ observableInventoryUnits: 101 }), 0);
      return { policy: right, sensitivity: [left, right], tie: left, missing: pricingContext(pricingSku({ observableInventoryUnits: null }), 0), multi: null };
    }
    const left = pricingContext(pricingSku({ activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"], promotionOwners: { promo_heuristic_calendar_fall_a_v1: "heuristic" } }), 4); const right = pricingContext(pricingSku(), 4);
    return { policy: right, sensitivity: [left, right], tie: left, missing: pricingContext(pricingSku({ promotionEligible: false }), 4), multi: null };
  }
  if (operatorId.startsWith("baseline.merchandising.")) {
    const left = merchandisingContext([merchProduct("product:A", 1, 10), merchProduct("product:B", 2, 30), merchProduct("product:C", 3, 20)]);
    const right = merchandisingContext([merchProduct("product:A", 1, 30), merchProduct("product:B", 2, 10), merchProduct("product:C", 3, 20)]);
    const tie = merchandisingContext([merchProduct("product:A", 2, 20), merchProduct("product:B", 1, 20)]);
    const missing = operatorId.endsWith("rank_by_revenue")
      ? merchandisingContext([merchProduct("product:A", 1, 10, { revenueMinor: null }), merchProduct("product:B", 2, 20, { available: false })])
      : operatorId.endsWith("rank_by_conversion_rate")
        ? merchandisingContext([merchProduct("product:A", 1, 10, { productViews: 0, conversions: 0 }), merchProduct("product:B", 2, 20, { productViews: 10 })])
        : merchandisingContext([merchProduct("product:A", 1, 10, { unitsSold: null, newlyLaunched: true }), merchProduct("product:B", 2, 20, { unitsSold: null })]);
    return { policy: left, sensitivity: [left, right], tie, missing, multi: left };
  }
  if (operatorId.startsWith("baseline.greedy.")) {
    const left = greedyContext([greedyChannel("google_ads", 400_000, 300_000, 200_000), greedyChannel("meta_ads", 100_000, 50_000, 25_000)]);
    const right = greedyContext([greedyChannel("google_ads", 100_000, 50_000, 25_000), greedyChannel("meta_ads", 400_000, 300_000, 200_000)]);
    const tie = greedyContext([greedyChannel("google_ads", 200_000, 200_000, 200_000), greedyChannel("meta_ads", 200_000, 200_000, 200_000)]);
    const missingChannels = operatorId.endsWith("immediate_revenue")
      ? [greedyChannel("google_ads", 0, 100, 100), greedyChannel("meta_ads", 0, 100, 100)].map((channel) => ({ ...channel, attributedRevenueMinor: null }))
      : operatorId.endsWith("immediate_gross_profit")
        ? [greedyChannel("google_ads", 100, 0, 100), greedyChannel("meta_ads", 100, 0, 100)].map((channel) => ({ ...channel, attributedGrossProfitMinor: null }))
        : [greedyChannel("google_ads", 100, 100, 0), greedyChannel("meta_ads", 100, 100, 0)].map((channel) => ({ ...channel, attributedContributionMinor: null }));
    return { policy: left, sensitivity: [left, right], tie, missing: greedyContext(missingChannels, 0, 0), multi: null };
  }
  const channelsA = [flawedChannel("google_ads", 400_000, 10, 20), flawedChannel("meta_ads", 100_000, 2, 4)];
  const channelsB = [flawedChannel("google_ads", 100_000, 2, 4), flawedChannel("meta_ads", 400_000, 10, 20)];
  const productsA = [flawedProduct("product:A", 30), flawedProduct("product:B", 10)];
  const productsB = [flawedProduct("product:A", 10), flawedProduct("product:B", 30)];
  const left = flawedContext(channelsA, productsA); const right = flawedContext(channelsB, productsB);
  const tie = flawedContext([flawedChannel("google_ads", 200_000, 5, 10), flawedChannel("meta_ads", 200_000, 5, 10)], [flawedProduct("product:A", 20), flawedProduct("product:B", 20)]);
  const missing = operatorId.endsWith("max_roas")
    ? flawedContext(channelsA.map((channel) => ({ ...channel, spendMinor: 0 })), productsA, 0, 0)
    : operatorId.endsWith("min_cac")
      ? flawedContext(channelsA.map((channel) => ({ ...channel, representedNewCustomers: 0 })), productsA, 0, 0)
      : operatorId.endsWith("lowest_cpa")
        ? flawedContext(channelsA.map((channel) => ({ ...channel, representedPurchaseConversions: 0 })), productsA, 0, 0)
        : operatorId.endsWith("highest_conversion_rate")
          ? flawedContext(channelsA, productsA.map((product) => ({ ...product, productViews: 0 })), 0, 0)
          : operatorId.endsWith("best_seller_push")
            ? flawedContext(channelsA, productsA.map((product) => ({ ...product, unitsSold: null })), 0, 0)
            : flawedContext(channelsA.map((channel) => ({ ...channel, attributedRevenueMinor: null })), productsA.map((product) => ({ ...product, recentUnits: null, revenueMinor: null })), 0, 0);
  return { policy: left, sensitivity: [left, right], tie, missing, multi: null };
}

export function createCompleteBaselineValidationCase(legacyOperator: CanonicalOperator, index: number): BaselineValidationCase {
  const operator = ensureCanonicalOperatorV2(legacyOperator);
  const caseId = `frozen-baseline-${String(index + 1).padStart(2, "0")}`;
  const inputs = familyEvidenceInputs(operator.metadata.operatorId);
  const { opportunity, observation, availability, input } = inputs.policy;
  const decision = operator.decide(input);
  const seedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[index % FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length]!;
  const secondSeedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[(index + 1) % FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length]!;
  const operatorBinding = { operatorId: operator.metadata.operatorId, operatorVersion: operator.metadata.operatorVersion, implementationFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, adapterFingerprint: operator.metadata.adapterFingerprint };
  const repeatedExecution = () => ({ operatorBinding, canonicalInput: input, canonicalInputFingerprint: canonicalInputFingerprint(input) });
  const frozenSeedBinding = (candidate: typeof seedCase) => ({ seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion, seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint, seedCaseId: candidate.caseId, worldProfile: candidate.worldProfile, seeds: candidate.seeds, seedBindingFingerprint: evaluationFingerprint({ seedCaseId: candidate.caseId, seeds: candidate.seeds }) });
  const provenanceSeedBinding = (candidate: typeof seedCase) => ({
    seedCaseId: candidate.caseId,
    worldProfile: candidate.worldProfile,
    seeds: candidate.seeds,
    seedBindingFingerprint: evaluationFingerprint({ seedCaseId: candidate.caseId, seeds: candidate.seeds }),
  });
  const isolationEvidence = (section: "hidden_truth_isolation" | "future_information_isolation", witnesses: readonly [object, object]) => ({ operatorBinding, primaryInputFingerprint: canonicalInputFingerprint(input), pairs: [{ pairId: `${caseId}:${section}`, canonicalInput: input, canonicalInputFingerprint: canonicalInputFingerprint(input), baselineWitness: witnesses[0], baselineWitnessFingerprint: evaluationFingerprint(witnesses[0]), variantWitness: witnesses[1], variantWitnessFingerprint: evaluationFingerprint(witnesses[1]) }] });
  const witnesses = familyWitnesses(operator.metadata.operatorId);
  const temporalKind = operator.metadata.operatorId.startsWith("baseline.advertising.") || operator.metadata.operatorId.startsWith("baseline.greedy.") || operator.metadata.operatorId.startsWith("baseline.flawed.") ? "advertising_outcome" as const
    : operator.metadata.operatorId.startsWith("baseline.inventory.") ? "inventory_event" as const
      : operator.metadata.operatorId.startsWith("baseline.pricing.") || operator.metadata.operatorId.startsWith("baseline.promotion.") ? "promotion_outcome" as const
        : "customer_event" as const;
  const temporalPayload = (record: typeof input.observation.records[number]) => ({ observationKey: record.observationKey, observationFingerprint: input.provenance.observationFingerprint, data: record.value, dataFingerprint: evaluationFingerprint(record.value) });
  const temporalObservations = input.observation.records.map((record, recordIndex) => ({ eventId: `${caseId}:observation:${recordIndex}`, kind: temporalKind, occurredAt: record.sourceMaxOccurredAt, payload: temporalPayload(record) }));
  const lookbackObservations = input.observation.records.flatMap((record, recordIndex) => record.sourceMinOccurredAt === record.sourceMaxOccurredAt
    ? [{ eventId: `${caseId}:lookback:${recordIndex}`, kind: temporalKind, occurredAt: record.sourceMinOccurredAt, payload: temporalPayload(record) }]
    : [{ eventId: `${caseId}:lookback:${recordIndex}:start`, kind: temporalKind, occurredAt: record.sourceMinOccurredAt, payload: temporalPayload(record) }, { eventId: `${caseId}:lookback:${recordIndex}:end`, kind: temporalKind, occurredAt: record.sourceMaxOccurredAt, payload: temporalPayload(record) }]);
  const lookbackStart = input.observation.records.reduce((earliest, record) => Date.parse(record.sourceMinOccurredAt) < Date.parse(earliest) ? record.sourceMinOccurredAt : earliest, opportunity.at);
  const evaluated = invokeOperatorAtDecision(contract, legacyOperator, opportunity, observation, availability, () => ({ issues: [] }));
  const disposition = { contract, opportunity, availability, attempts: decision.actions.map((rawProposal, actionIndex) => ({ rawProposal, constraintIssues: [], explicitModifiedAction: null, attemptRecord: evaluated.decisionRecord.actionAttempts[actionIndex]! })) };
  const replay = createRecordedDecisionArtifact(operator, input, decision, {
    constraintFingerprint: evaluationFingerprint(input.constraints),
    schemaFingerprint: canonicalReplaySchemaFingerprint(),
    seedCaseId: seedCase.caseId,
    seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion,
    seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
    seeds: seedCase.seeds,
    seedFingerprint: evaluationFingerprint(seedCase.seeds),
  });
  const policyActionFingerprints = FROZEN_POLICY_ACTION_FINGERPRINTS[operator.metadata.operatorId]!;
  const exact = { kind: "exact" as const, expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint(policyActionFingerprints)], expectedActionFingerprints: [policyActionFingerprints] };
  const tieActionFingerprints = FROZEN_TIE_ACTION_FINGERPRINTS[operator.metadata.operatorId]!;
  const tieExact = { kind: "exact" as const, expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint(tieActionFingerprints)], expectedActionFingerprints: [tieActionFingerprints] };
  const missingExact = { kind: "exact" as const, expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] };
  const notApplicable = (checkId: "permitted_information_sensitivity" | "multi_action_behavior") => ({
    kind: "not_applicable" as const,
    disposition: "NOT_APPLICABLE_BY_FROZEN_CAPABILITY" as const,
    reasonCode: checkId === "permitted_information_sensitivity"
      ? "ZERO_ACTION_CAPABILITY" as const
      : operator.metadata.capabilities.maximumActionsPerDecision <= 1
        ? "MAXIMUM_ACTIONS_PER_DECISION_LE_ONE" as const
        : "FROZEN_SINGLE_EMISSION_SEMANTICS" as const,
  });
  return {
    caseId,
    operator: legacyOperator,
    evidence: {
      determinism: repeatedExecution(),
      seedReproducibility: { operatorBinding, baseCanonicalInput: input, baseCanonicalInputFingerprint: canonicalInputFingerprint(input), seedCases: [frozenSeedBinding(seedCase), frozenSeedBinding(secondSeedCase)] },
      hiddenTruthIsolation: isolationEvidence("hidden_truth_isolation", witnesses.hidden),
      futureInformationIsolation: isolationEvidence("future_information_isolation", witnesses.future),
      temporalBoundary: { decisionTimestamp: opportunity.at, observationFingerprint: input.provenance.observationFingerprint, observations: temporalObservations },
      lookbackWindow: { startInclusive: lookbackStart, endInclusive: opportunity.at, decisionTimestamp: opportunity.at, observationFingerprint: input.provenance.observationFingerprint, observations: lookbackObservations },
      actionConformance: { contract, opportunity, availability, canonicalInput: input, operatorMetadata: operator.metadata, decisionEnvelope: decision },
      constraintConformance: disposition,
      policySemantics: executableProbe(operator, caseId, "policy_semantics", "missing_data", [input], exact, canonicalInputFingerprint(input)),
      permittedInformationSensitivity: inputs.sensitivity === null
        ? executableProbe(operator, caseId, "permitted_information_sensitivity", "single_action", [input], notApplicable("permitted_information_sensitivity"), canonicalInputFingerprint(input))
        : executableProbe(operator, caseId, "permitted_information_sensitivity", "single_action", inputs.sensitivity.map((entry) => entry.input), { kind: "sensitive", observationKeys: inputs.sensitivity[0].input.observation.records.map((record) => record.observationKey) }, canonicalInputFingerprint(input)),
      prohibitedInformationInvariance: prohibitedProbe(operator, caseId, input),
      tieBreaking: executableProbe(operator, caseId, "tie_breaking", "exact_tie", [inputs.tie.input], tieExact, canonicalInputFingerprint(input)),
      missingDataBehavior: executableProbe(operator, caseId, "missing_data_behavior", "missing_data", [inputs.missing.input], missingExact, canonicalInputFingerprint(input)),
      zeroActionBehavior: executableProbe(operator, caseId, "zero_action_behavior", "empty", [missingObservationContext(inputs.policy).input], { kind: "zero_actions" }, canonicalInputFingerprint(input)),
      multiActionBehavior: inputs.multi === null
        ? executableProbe(operator, caseId, "multi_action_behavior", "multi_action", [input], notApplicable("multi_action_behavior"), canonicalInputFingerprint(input))
        : executableProbe(operator, caseId, "multi_action_behavior", "multi_action", [inputs.multi.input], { kind: "multi_action" }, canonicalInputFingerprint(input)),
      artifactReplay: replay,
      provenanceIntegrity: [
        { label: `seed-binding:${seedCase.caseId}`, value: provenanceSeedBinding(seedCase), recordedFingerprint: evaluationFingerprint(provenanceSeedBinding(seedCase)) },
        { label: `seed-binding:${secondSeedCase.caseId}`, value: provenanceSeedBinding(secondSeedCase), recordedFingerprint: evaluationFingerprint(provenanceSeedBinding(secondSeedCase)) },
        { label: "canonical-input", value: input, recordedFingerprint: evaluationFingerprint(input) },
      ],
      uncontrolledRandomness: repeatedExecution(),
      operatorIsolation: { canonicalInputBefore: input, canonicalInputAfter: input, operatorMetadata: operator.metadata, decisionEnvelope: decision, evaluatedDecision: evaluated, dispositionEvidence: disposition },
    },
  };
}

export const ALL_BASELINE_VALIDATION_CASES = Object.freeze(
  FROZEN_BASELINE_OPERATORS.map((operator, index) => createCompleteBaselineValidationCase(operator, index)),
);
