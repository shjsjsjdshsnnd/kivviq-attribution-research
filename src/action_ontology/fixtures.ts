import { currencyCode, utcTimestamp } from "../core/units.js";
import { assertValidAction } from "./validation.js";
import {
  ACTION_ONTOLOGY_VERSION,
  RISK_DIMENSIONS,
  type Action,
  type ActionCost,
  type ActionMeasurementHorizon,
  type ActionReversibility,
  type KnowledgeValue,
  type MonetaryAmount,
  type ParameterValue,
  type ValueProvenance,
} from "./types.js";

const CAD = currencyCode("CAD");
const DAY = 86_400;
const WEEK = DAY * 7;

function known<T>(
  value: T,
  provenance: ValueProvenance = "operator_input",
): KnowledgeValue<T> {
  return { status: "known", value, provenance };
}

function estimated<T>(value: T): KnowledgeValue<T> {
  return { status: "estimated", value, provenance: "modeled_estimate" };
}

function unknownValue<T>(reason: string): KnowledgeValue<T> {
  return { status: "unknown", provenance: "unknown", reason };
}

function na<T>(reason: string): KnowledgeValue<T> {
  return { status: "not_applicable", provenance: "not_applicable", reason };
}

function money(amountMinor: number): MonetaryAmount {
  return { amountMinor, currency: CAD };
}

function moneyValue(amountMinor: number): ParameterValue {
  return { kind: "money", amountMinor, currency: CAD };
}

function moneyRateValue(
  amountMinor: number,
  per: "day" | "week" | "month",
): ParameterValue {
  return { kind: "money_rate", amountMinor, currency: CAD, per };
}

function pct(
  basisPoints: number,
  semantics:
    | "relative_change"
    | "absolute_share"
    | "percentage_points"
    | "discount_rate"
    | "margin_rate",
): ParameterValue {
  return { kind: "percentage", basisPoints, semantics };
}

function costs(): ActionCost {
  return {
    incrementalSpend: unknownValue("requires evaluation"),
    implementationCost: unknownValue("not yet estimated"),
    discountMarginCost: unknownValue("not yet estimated"),
    operationalCost: unknownValue("not yet estimated"),
    opportunityCost: unknownValue("not yet estimated"),
    totalEconomicExposure: unknownValue("requires evaluation"),
  };
}

function risks() {
  return RISK_DIMENSIONS.map((dimension) => ({
    dimension,
    probability: unknownValue<number>("requires evaluation"),
    impact: unknownValue("requires evaluation"),
  }));
}

function measurement(metrics: readonly string[], primary = WEEK * 2): ActionMeasurementHorizon {
  return {
    earliestMeaningfulObservationSeconds: known(DAY * 3, "derived"),
    primaryEvaluationSeconds: known(primary, "derived"),
    longerTermEvaluationSeconds: known(Math.max(primary * 2, WEEK * 4), "derived"),
    metrics: metrics.map((metricId) => ({ metricId })),
    baseline: {
      strategy: "same_length_prior",
      lookbackSeconds: Math.max(primary, WEEK * 2),
      minimumObservations: 1,
    },
  };
}

function reversible(mechanism: string): ActionReversibility {
  return {
    classification: "fully_reversible",
    reversalMechanism: known(mechanism),
    reversalCost: unknownValue("not yet estimated"),
    reversalDelaySeconds: estimated(300),
  };
}

function partiallyReversible(mechanism: string): ActionReversibility {
  return {
    classification: "partially_reversible",
    reversalMechanism: known(mechanism),
    reversalCost: unknownValue("some completed effects cannot be undone"),
    reversalDelaySeconds: estimated(300),
  };
}

function fixture(input: Record<string, unknown>): Action {
  return assertValidAction({
    ontologyVersion: ACTION_ONTOLOGY_VERSION,
    version: 1,
    atomicity: "ATOMIC",
    timing: {
      proposedStart: known(utcTimestamp("2026-09-21T13:00:00Z")),
      earliestPossibleStart: known(utcTimestamp("2026-09-21T12:00:00Z")),
      latestUsefulStart: known(utcTimestamp("2026-09-23T13:00:00Z")),
      schedulingRequirements: [],
      dependencies: [],
    },
    duration: {
      kind: "persistent",
      durationSeconds: na("persistent action"),
      endTime: na("persistent action"),
    },
    cost: costs(),
    constraints: [],
    reversibility: reversible("restore the prior configuration"),
    risks: risks(),
    measurement: measurement(["net_revenue", "contribution_profit"]),
    state: "PROPOSED",
    ...input,
  });
}

export const increaseGoogleShoppingBudget20 = fixture({
  actionId: "act-google-shopping-budget-up-20",
  actionType: "paid_media.adjust_budget",
  actionCategory: "paid_media",
  description: "Increase Google Shopping campaign budget by 20%.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "campaign:google-shopping",
  },
  parameters: [
    {
      parameterId: "budget_change",
      mode: "INCREASE_BY_PERCENT",
      value: pct(2_000, "relative_change"),
    },
  ],
  cost: { ...costs(), incrementalSpend: estimated(money(140_000)) },
  measurement: measurement([
    "paid_media.spend",
    "orders",
    "net_revenue",
    "contribution_profit",
  ]),
});

export const pauseUnderperformingMetaCampaign = fixture({
  actionId: "act-pause-meta-underperformer",
  actionType: "paid_media.pause_campaign",
  actionCategory: "paid_media",
  description: "Pause an underperforming Meta campaign.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "campaign:meta-underperformer",
  },
  parameters: [
    {
      parameterId: "state_change",
      mode: "PAUSE",
      value: { kind: "boolean", value: true },
    },
  ],
  reversibility: reversible("resume the same campaign"),
});

export const reduceProductPrice10 = fixture({
  actionId: "act-price-product-101-down-10",
  actionType: "pricing.adjust_product_price",
  actionCategory: "pricing",
  description: "Reduce Product 101 price by 10%.",
  target: { kind: "price", productId: "product:101", skuId: "sku:101" },
  parameters: [
    {
      parameterId: "price_change",
      mode: "DECREASE_BY_PERCENT",
      value: pct(1_000, "relative_change"),
      fromValue: moneyValue(89_900),
      toValue: moneyValue(80_910),
    },
  ],
  constraints: [
    {
      constraintId: "margin-floor",
      kind: "property_comparison",
      property: "product.gross_margin_rate",
      operator: "GTE",
      value: pct(3_000, "margin_rate"),
      whenUnmet: "INVALID",
    },
  ],
  cost: { ...costs(), discountMarginCost: estimated(money(45_000)) },
  reversibility: partiallyReversible(
    "restore prior price; completed discounted sales remain final",
  ),
  measurement: measurement([
    "product.conversion_rate",
    "product.units_sold",
    "product.gross_margin_rate",
    "product.expected_contribution_per_unit_minor",
  ]),
});

export const runCollectionPromotion15FourDays = fixture({
  actionId: "act-rugs-promo-15-four-days",
  actionType: "promotions.collection_discount",
  actionCategory: "promotions",
  description: "Run a 15% collection promotion for four days.",
  target: { kind: "collection", collectionId: "collection:rugs" },
  parameters: [
    {
      parameterId: "discount_rate",
      mode: "APPLY",
      value: pct(1_500, "discount_rate"),
    },
  ],
  duration: {
    kind: "temporary",
    durationSeconds: known(DAY * 4),
    endTime: known(utcTimestamp("2026-09-25T13:00:00Z")),
  },
  cost: { ...costs(), discountMarginCost: estimated(money(180_000)) },
  reversibility: partiallyReversible(
    "end the promotion; completed discounted orders cannot be undone",
  ),
  measurement: measurement(
    ["collection.net_revenue", "collection.margin", "collection.contribution_profit"],
    WEEK,
  ),
});

export const increaseEmailCampaignFrequency = fixture({
  actionId: "act-email-frequency-2-to-3",
  actionType: "crm.adjust_campaign_frequency",
  actionCategory: "email_sms_crm",
  description: "Increase email campaign frequency from 2 to 3 sends per week.",
  target: {
    kind: "email_campaign",
    emailCampaignId: "email-campaign:weekly-editorial",
  },
  parameters: [
    {
      parameterId: "frequency_change",
      mode: "SET",
      fromValue: { kind: "frequency", value: 2, per: "week" },
      toValue: { kind: "frequency", value: 3, per: "week" },
    },
  ],
  reversibility: reversible("restore two sends per week"),
  measurement: measurement([
    "crm.revenue",
    "crm.unsubscribe_rate",
    "crm.spam_complaint_rate",
  ]),
});

export const moveProductHigherInCollection = fixture({
  actionId: "act-merch-product-202-position-1",
  actionType: "merchandising.move_collection_position",
  actionCategory: "merchandising",
  description: "Move Product 202 from position 6 to position 1.",
  target: {
    kind: "merchandising_placement",
    collectionId: "collection:dining",
    productId: "product:202",
  },
  parameters: [
    {
      parameterId: "position_change",
      mode: "MOVE_TO",
      fromValue: { kind: "position", value: 6 },
      toValue: { kind: "position", value: 1 },
    },
  ],
  reversibility: reversible("restore Product 202 to position 6"),
});

const sharedIntentId = "intent:move-1000-meta-to-google";
const parentActionId = "act-reallocate-meta-to-google-1000";

const metaDecrease = fixture({
  actionId: "act-reallocate-meta-down-1000",
  actionType: "paid_media.adjust_budget",
  actionCategory: "paid_media",
  description: "Decrease Meta prospecting by CAD 1,000 per week.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "campaign:meta-prospecting",
  },
  parameters: [
    {
      parameterId: "budget_change",
      mode: "DECREASE_BY",
      value: moneyRateValue(100_000, "week"),
    },
  ],
  sharedIntentId,
  parentActionId,
});

const googleIncrease = fixture({
  actionId: "act-reallocate-google-up-1000",
  actionType: "paid_media.adjust_budget",
  actionCategory: "paid_media",
  description: "Increase Google Shopping by CAD 1,000 per week.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "campaign:google-shopping",
  },
  parameters: [
    {
      parameterId: "budget_change",
      mode: "INCREASE_BY",
      value: moneyRateValue(100_000, "week"),
    },
  ],
  sharedIntentId,
  parentActionId,
});

export const reallocateMetaToGoogle1000PerWeek = fixture({
  actionId: parentActionId,
  actionType: "paid_media.reallocate_budget",
  actionCategory: "paid_media",
  description: "Move CAD 1,000 per week from Meta prospecting to Google Shopping.",
  atomicity: "COMPOUND",
  target: { kind: "compound", targets: [metaDecrease.target, googleIncrease.target] },
  parameters: [
    {
      parameterId: "transfer_amount",
      mode: "SET",
      value: moneyRateValue(100_000, "week"),
    },
  ],
  sharedIntentId,
  components: [metaDecrease, googleIncrease],
  coordination: {
    executionPolicy: "all_or_nothing",
    dependencies: [
      {
        componentActionId: googleIncrease.actionId,
        dependsOnActionIds: [metaDecrease.actionId],
      },
    ],
  },
  cost: { ...costs(), incrementalSpend: known(money(0), "derived") },
  reversibility: reversible("transfer the same amount back"),
});

export const stopAdsForLowInventoryHighRoasSku = fixture({
  actionId: "act-stop-ads-low-inventory-sku",
  actionType: "paid_media.stop_product_advertising",
  actionCategory: "paid_media",
  description:
    "Stop advertising a high-ROAS SKU when available inventory reaches 17 units or fewer.",
  target: {
    kind: "sku",
    productId: "product:inventory-trap",
    skuId: "sku:inventory-trap",
  },
  parameters: [
    {
      parameterId: "state_change",
      mode: "PAUSE",
      value: { kind: "boolean", value: true },
    },
  ],
  constraints: [
    {
      constraintId: "inventory-threshold",
      kind: "property_comparison",
      property: "inventory.available_units",
      operator: "LTE",
      value: { kind: "number", value: 17, unit: "units" },
      whenUnmet: "INVALID",
    },
  ],
  measurement: measurement([
    "inventory.available_units",
    "paid_media.platform_product_roas",
    "product.expected_contribution_per_unit_minor",
    "product.structural_demand_units_per_day",
    "product.substitution_product_ids",
  ]),
  reversibility: reversible("resume advertising after inventory recovers"),
});

export const increaseAdsConditionalOnContribution = fixture({
  actionId: "act-scale-product-if-contribution-safe",
  actionType: "paid_media.adjust_product_budget",
  actionCategory: "paid_media",
  description:
    "Increase product advertising by 15% only while contribution, margin and inventory remain above floors.",
  target: {
    kind: "sku",
    productId: "product:scale-candidate",
    skuId: "sku:scale-candidate",
  },
  parameters: [
    {
      parameterId: "budget_change",
      mode: "INCREASE_BY_PERCENT",
      value: pct(1_500, "relative_change"),
    },
  ],
  constraints: [
    {
      constraintId: "contribution-floor",
      kind: "property_comparison",
      property: "product.expected_contribution_per_unit_minor",
      operator: "GTE",
      value: moneyValue(5_000),
      whenUnmet: "BLOCKED",
    },
    {
      constraintId: "margin-floor",
      kind: "property_comparison",
      property: "product.gross_margin_rate",
      operator: "GTE",
      value: pct(3_500, "margin_rate"),
      whenUnmet: "BLOCKED",
    },
    {
      constraintId: "inventory-floor",
      kind: "property_comparison",
      property: "inventory.available_units",
      operator: "GTE",
      value: { kind: "number", value: 50, unit: "units" },
      whenUnmet: "BLOCKED",
    },
  ],
  measurement: measurement([
    "product.expected_contribution_per_unit_minor",
    "product.gross_margin_rate",
    "product.return_rate",
    "product.shipping_cost_per_unit_minor",
    "product.fulfillment_cost_per_unit_minor",
    "product.structural_demand_units_per_day",
  ]),
});

export const reverseGoogleShoppingBudgetIncrease = fixture({
  actionId: "act-reverse-google-shopping-budget-up-20",
  actionType: "paid_media.adjust_budget",
  actionCategory: "paid_media",
  description: "Reverse a previous budget increase by restoring the prior budget.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "campaign:google-shopping",
  },
  parameters: [
    {
      parameterId: "budget_change",
      mode: "SET",
      fromValue: moneyValue(120_000),
      toValue: moneyValue(100_000),
    },
  ],
  reversalOfActionId: "act-google-shopping-budget-up-20",
  cost: { ...costs(), incrementalSpend: known(money(0), "derived") },
});

export const ACTION_ONTOLOGY_FIXTURES = [
  increaseGoogleShoppingBudget20,
  pauseUnderperformingMetaCampaign,
  reduceProductPrice10,
  runCollectionPromotion15FourDays,
  increaseEmailCampaignFrequency,
  moveProductHigherInCollection,
  reallocateMetaToGoogle1000PerWeek,
  stopAdsForLowInventoryHighRoasSku,
  increaseAdsConditionalOnContribution,
  reverseGoogleShoppingBudgetIncrease,
] as const;
