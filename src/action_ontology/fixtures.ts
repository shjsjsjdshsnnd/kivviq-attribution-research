import { currencyCode, utcTimestamp } from "../core/units.js";
import { actionId, actionType, constraintId } from "./identity.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionCost,
  type ActionMeasurementHorizon,
  type ActionProvenance,
  type ActionRiskDimension,
  type CompoundAction,
  type KnownOrUnknown,
  type MonetaryValue,
} from "./types.js";
import { assertValidAction } from "./validation.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-21T13:00:00Z");
const FIVE_MINUTES_LATER = utcTimestamp("2026-09-21T13:05:00Z");
const FOUR_DAYS = 4 * 24 * 60 * 60;
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function money(amountMinor: number): MonetaryValue {
  return { kind: "money", amountMinor, currency: CAD };
}

function unknownMoney(reason: string): KnownOrUnknown<MonetaryValue> {
  return { kind: "unknown", reason };
}

function knownMoney(amountMinor: number, sourceRef: string): KnownOrUnknown<MonetaryValue> {
  return { kind: "known", value: money(amountMinor), sourceRef };
}

function defaultCost(): ActionCost {
  return {
    directFinancialCost: unknownMoney("not committed by the Action definition"),
    mediaSpend: unknownMoney("depends on realized delivery"),
    implementationCost: unknownMoney("not yet supplied"),
    engineeringCost: unknownMoney("not yet supplied"),
    operationalCost: unknownMoney("not yet supplied"),
    promotionalCost: unknownMoney("not applicable unless measured later"),
    inventoryCommitment: unknownMoney("not applicable unless measured later"),
    opportunityCostReference: "evaluate separately; never record as realized expense",
  };
}

function defaultRisks(): readonly ActionRiskDimension[] {
  return [
    {
      dimension: "financial_downside",
      downsideDefinition: "The intervention can consume spend without sufficient incremental return.",
    },
    {
      dimension: "inventory_exposure",
      downsideDefinition: "Additional demand can deplete constrained sellable inventory.",
    },
    {
      dimension: "measurement_uncertainty",
      downsideDefinition: "Observed post-action movement may not identify the causal effect.",
    },
  ];
}

function defaultMeasurement(): ActionMeasurementHorizon {
  return {
    earliestMeaningfulEvaluationSeconds: 3 * 24 * 60 * 60,
    primaryEvaluationSeconds: FOURTEEN_DAYS,
    longTermFollowUpSeconds: THIRTY_DAYS,
    outcomes: [
      {
        family: "incremental_contribution_profit",
        metricId: "incremental_contribution_profit",
        role: "primary",
      },
      {
        family: "inventory_position",
        metricId: "sellable_inventory_units",
        role: "guardrail",
      },
    ],
  };
}

function provenance(source: ActionProvenance["source"] = "human"): ActionProvenance {
  return {
    source,
    createdAt: utcTimestamp("2026-09-21T13:00:00Z"),
    evidenceRefs: [],
  };
}

function baseAction(overrides: Partial<Action>): Action {
  return assertValidAction({
    kind: "atomic_action",
    actionId: actionId("action_placeholder"),
    actionType: actionType("no_op.do_nothing"),
    actionCategory: "no_op",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description: "Intentional no-op placeholder.",
    target: { kind: "merchant", merchantId: "merchant:synthetic" },
    scope: { dimensions: [] },
    parameters: { kind: "no_op", reasonCode: "placeholder" },
    timing: {
      decisionTime: DECISION,
      requestedStart: { kind: "known", at: DECISION },
      effectiveStart: { kind: "known", at: DECISION },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: { kind: "temporary", durationSeconds: FOURTEEN_DAYS },
    termination: { kind: "fixed_duration", durationSeconds: FOURTEEN_DAYS },
    cost: defaultCost(),
    resourceRequirements: [],
    constraints: [],
    preconditions: [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: { kind: "merchant", merchantId: "merchant:synthetic" },
        parameterKind: "no_op",
      },
      minimumDelaySeconds: 0,
    },
    riskDimensions: defaultRisks(),
    uncertaintyDimensions: [
      {
        dimension: "causal_effect",
        informationGap: "No outcome effect is stored inside Action.",
      },
    ],
    measurement: defaultMeasurement(),
    intent: { statement: "Represent a possible business intervention." },
    provenance: provenance(),
    ...overrides,
  });
}

export const increaseGoogleShoppingBudget20 = baseAction({
  actionId: actionId("action_google_shopping_budget_multiply_120"),
  actionType: actionType("advertising.adjust_budget"),
  actionCategory: "advertising",
  description: "Increase Google Shopping budget by 20% for 14 days.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_shopping",
  },
  parameters: {
    kind: "budget_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 1.2,
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: DECISION },
    effectiveStart: { kind: "known", at: FIVE_MINUTES_LATER },
    implementationDelaySeconds: { kind: "known", seconds: 300 },
  },
  resourceRequirements: [
    {
      resourceType: "advertising_budget",
      amount: unknownMoney("increment depends on the observable decision-time baseline"),
    },
  ],
  constraints: [
    {
      constraintId: constraintId("budget_available"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "budget.available_minor",
        operator: "GT",
        value: money(0),
      },
      description: "Additional spend requires available budget.",
    },
    {
      constraintId: constraintId("preferred_margin"),
      constraintClass: "soft",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.gross_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 4500 },
      },
      description: "Prefer at least 45% gross margin.",
    },
  ],
  preconditions: [
    {
      preconditionId: "campaign_exists",
      expression: {
        kind: "entity_exists",
        target: {
          kind: "campaign",
          channelId: "google_ads",
          campaignId: "google_shopping",
        },
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
  reversibility: {
    classification: "immediately_reversible",
    reversal: {
      kind: "restore_previous_value",
      target: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_shopping",
      },
      parameterKind: "budget_adjustment",
    },
    minimumDelaySeconds: 0,
  },
  intent: { statement: "Capture additional profitable demand." },
});

export const setGoogleShoppingBudgetAbsolute = baseAction({
  actionId: actionId("action_google_shopping_budget_set_11000_week"),
  actionType: actionType("advertising.adjust_budget"),
  actionCategory: "advertising",
  description: "Set Google Shopping budget to CAD 11,000 per week.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_shopping",
  },
  parameters: {
    kind: "budget_adjustment",
    operation: {
      kind: "SET",
      value: {
        kind: "money_rate",
        amountMinor: 1_100_000,
        currency: CAD,
        per: "week",
      },
    },
  },
});

export const increaseGoogleShoppingBudgetBy1000 = baseAction({
  actionId: actionId("action_google_shopping_budget_delta_1000_week"),
  actionType: actionType("advertising.adjust_budget"),
  actionCategory: "advertising",
  description: "Increase Google Shopping budget by CAD 1,000 per week.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_shopping",
  },
  parameters: {
    kind: "budget_adjustment",
    operation: {
      kind: "DELTA",
      direction: "increase",
      amount: {
        kind: "money_rate",
        amountMinor: 100_000,
        currency: CAD,
        per: "week",
      },
      reference: {
        kind: "explicit_baseline",
        value: {
          kind: "money_rate",
          amountMinor: 1_000_000,
          currency: CAD,
          per: "week",
        },
      },
    },
  },
});

export const pauseUnderperformingMetaCampaign = baseAction({
  actionId: actionId("action_meta_campaign_pause"),
  actionType: actionType("advertising.pause_campaign"),
  actionCategory: "advertising",
  description: "Pause a Meta prospecting campaign.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "meta_prospecting",
  },
  parameters: {
    kind: "toggle",
    setting: "campaign_enabled",
    value: false,
  },
  duration: { kind: "until_reversed" },
  termination: { kind: "manual_reversal" },
  reversibility: {
    classification: "immediately_reversible",
    reversal: {
      kind: "restore_previous_value",
      target: {
        kind: "campaign",
        channelId: "meta_ads",
        campaignId: "meta_prospecting",
      },
      parameterKind: "toggle",
    },
    minimumDelaySeconds: 0,
  },
});

export const reduceProductPrice10 = baseAction({
  actionId: actionId("action_product_price_multiply_090"),
  actionType: actionType("pricing.adjust_price"),
  actionCategory: "pricing",
  description: "Reduce a product price by 10%.",
  target: { kind: "product", productId: "product:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
  constraints: [
    {
      constraintId: constraintId("price_floor"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "price.floor_minor",
        operator: "LTE",
        value: money(20_000),
      },
    },
    {
      constraintId: constraintId("minimum_margin"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.gross_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3000 },
      },
      description: "Never allow the action when gross margin would violate the 30% floor.",
    },
  ],
});

export const runCollectionPromotion15FourDays = baseAction({
  actionId: actionId("action_collection_promo_15pct_4d"),
  actionType: actionType("promotion.apply_discount"),
  actionCategory: "promotion",
  description: "Apply a 15% collection promotion for four days.",
  target: { kind: "collection", collectionId: "collection:A" },
  scope: {
    dimensions: [
      { kind: "geography", include: ["CA"] },
      { kind: "device", devices: ["mobile"] },
      { kind: "customer_population", segmentIds: ["new_customers"] },
    ],
  },
  parameters: {
    kind: "promotion",
    discount: {
      kind: "SET",
      value: { kind: "percentage", basisPoints: 1500 },
    },
  },
  duration: { kind: "temporary", durationSeconds: FOUR_DAYS },
  termination: { kind: "fixed_duration", durationSeconds: FOUR_DAYS },
  cost: {
    ...defaultCost(),
    promotionalCost: unknownMoney("margin impact must be measured separately"),
  },
  constraints: [
    {
      constraintId: constraintId("max_discount"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "promotion.maximum_discount_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 1500 },
      },
    },
  ],
});

export const reorderInventoryWith45DayDelay = baseAction({
  actionId: actionId("action_inventory_reorder_50_units"),
  actionType: actionType("inventory.adjust_policy"),
  actionCategory: "inventory",
  description: "Order 50 additional units of a SKU with a 45-day implementation delay.",
  target: { kind: "sku", skuId: "sku:A", productId: "product:A" },
  parameters: {
    kind: "inventory",
    operation: {
      kind: "DELTA",
      direction: "increase",
      amount: { kind: "quantity", value: 50, unit: "units" },
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: DECISION },
    effectiveStart: {
      kind: "known",
      at: utcTimestamp("2026-11-05T13:00:00Z"),
    },
    implementationDelaySeconds: {
      kind: "known",
      seconds: 45 * 24 * 60 * 60,
    },
  },
  duration: { kind: "instantaneous" },
  termination: {
    kind: "fixed_end",
    at: utcTimestamp("2026-11-05T13:00:00Z"),
  },
  cost: {
    ...defaultCost(),
    inventoryCommitment: knownMoney(250_000, "purchase_order:synthetic"),
  },
  resourceRequirements: [
    {
      resourceType: "inventory",
      amount: {
        kind: "known",
        value: { kind: "quantity", value: 50, unit: "units" },
        sourceRef: "purchase_order:synthetic",
      },
    },
  ],
  reversibility: {
    classification: "effectively_irreversible",
    reversal: {
      kind: "none",
      reason: "Committed inventory cannot be meaningfully unpurchased after supplier commitment.",
    },
  },
  riskDimensions: [
    {
      dimension: "inventory_exposure",
      downsideDefinition: "Committed units may exceed realized sell-through.",
    },
    {
      dimension: "financial_downside",
      downsideDefinition: "Inventory commitment can tie up working capital.",
    },
    {
      dimension: "irreversibility",
      downsideDefinition: "Supplier commitment may not be cancellable.",
    },
  ],
  measurement: {
    earliestMeaningfulEvaluationSeconds: 45 * 24 * 60 * 60,
    primaryEvaluationSeconds: 60 * 24 * 60 * 60,
    longTermFollowUpSeconds: 120 * 24 * 60 * 60,
    outcomes: [
      { family: "inventory_position", role: "primary" },
      { family: "incremental_contribution_profit", role: "guardrail" },
    ],
  },
});

export const doNothingAction = baseAction({
  actionId: actionId("action_do_nothing_14d"),
  actionType: actionType("no_op.do_nothing"),
  actionCategory: "no_op",
  description: "Intentionally keep the current policy unchanged for 14 days.",
  parameters: { kind: "no_op", reasonCode: "current_policy_is_candidate" },
  cost: {
    directFinancialCost: knownMoney(0, "ontology:no_op"),
    mediaSpend: knownMoney(0, "ontology:no_op"),
    implementationCost: knownMoney(0, "ontology:no_op"),
    engineeringCost: knownMoney(0, "ontology:no_op"),
    operationalCost: knownMoney(0, "ontology:no_op"),
    promotionalCost: knownMoney(0, "ontology:no_op"),
    inventoryCommitment: knownMoney(0, "ontology:no_op"),
  },
  intent: { statement: "Measure the current policy as a first-class candidate action." },
});

export const waitObserveAction = baseAction({
  actionId: actionId("action_wait_observe_7d"),
  actionType: actionType("no_op.wait_observe"),
  actionCategory: "no_op",
  description: "Defer intervention for seven days while natural evidence accumulates.",
  parameters: {
    kind: "wait_observe",
    observationUntil: {
      kind: "time",
      at: utcTimestamp("2026-09-28T13:00:00Z"),
    },
  },
  duration: { kind: "temporary", durationSeconds: 7 * 24 * 60 * 60 },
  termination: { kind: "fixed_duration", durationSeconds: 7 * 24 * 60 * 60 },
  intent: {
    statement: "Wait because additional naturally arriving evidence is expected.",
  },
});

export const investigateTrackingAnomaly = baseAction({
  actionId: actionId("action_investigate_tracking_anomaly"),
  actionType: actionType("investigation.inspect"),
  actionCategory: "investigation",
  description: "Investigate an unexpected tracking anomaly.",
  parameters: {
    kind: "investigate",
    investigationType: "tracking_anomaly",
    question: "Why did observed checkout tracking diverge from order records?",
    requestedEvidenceRefs: ["checkout_events", "order_records"],
  },
  duration: { kind: "instantaneous" },
  termination: { kind: "persistent" },
  reversibility: {
    classification: "effectively_irreversible",
    reversal: {
      kind: "none",
      reason: "Information learned by an investigation cannot be unlearned.",
    },
  },
  intent: { statement: "Improve the information state before economic intervention." },
});

export const runExperimentAction = baseAction({
  actionId: actionId("action_run_checkout_experiment"),
  actionType: actionType("experimentation.run_experiment"),
  actionCategory: "experimentation",
  description: "Run a checkout experiment for 21 days.",
  target: { kind: "experiment", experimentId: "experiment:checkout-v1" },
  parameters: {
    kind: "run_experiment",
    hypothesisRef: "hypothesis:checkout-friction",
    interventionActionId: actionId("action_checkout_variant"),
    controlActionId: actionId("action_checkout_control"),
    targetPopulationRef: "population:eligible-checkout-sessions",
    durationSeconds: 21 * 24 * 60 * 60,
    primaryOutcomeMetricId: "checkout_conversion_rate",
  },
  duration: { kind: "temporary", durationSeconds: 21 * 24 * 60 * 60 },
  termination: {
    kind: "fixed_duration",
    durationSeconds: 21 * 24 * 60 * 60,
  },
  resourceRequirements: [
    {
      resourceType: "testing_traffic",
      amount: {
        kind: "unknown",
        reason: "required sample is determined by a future experiment planner",
      },
    },
  ],
  preconditions: [
    {
      preconditionId: "experiment_infrastructure_available",
      expression: {
        kind: "capability_available",
        capabilityId: "experimentation.checkout",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const reverseGoogleBudgetIncrease = baseAction({
  actionId: actionId("action_reverse_google_budget_increase"),
  actionType: actionType("advertising.adjust_budget"),
  actionCategory: "advertising",
  description: "Restore Google Shopping weekly budget to CAD 10,000.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_shopping",
  },
  parameters: {
    kind: "budget_adjustment",
    operation: {
      kind: "SET",
      value: {
        kind: "money_rate",
        amountMinor: 1_000_000,
        currency: CAD,
        per: "week",
      },
    },
  },
  reversalOfActionId: actionId("action_google_shopping_budget_multiply_120"),
});

export const budgetReallocationReadiness: CompoundAction = {
  kind: "compound_action",
  compoundActionId: actionId("action_compound_meta_to_google"),
  schemaVersion: ACTION_SCHEMA_VERSION,
  description: "Future compound action: decrease Meta and increase Google by paired amounts.",
  componentActionIds: [
    actionId("action_meta_budget_down_2000"),
    actionId("action_google_budget_up_2000"),
  ],
};
