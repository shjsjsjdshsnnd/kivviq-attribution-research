import { currencyCode, utcTimestamp } from "../core/units.js";
import {
  doNothingAction,
  increaseGoogleShoppingBudget20,
  increaseGoogleShoppingBudgetBy1000,
  investigateTrackingAnomaly,
  pauseUnderperformingMetaCampaign,
  runCollectionPromotion15FourDays,
  runExperimentAction,
  waitObserveAction,
} from "../action_ontology/fixtures.js";
import { actionId, actionType } from "../action_ontology/identity.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type CompoundAction,
  type MonetaryRateValue,
  type MonetaryValue,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type ResolvedCompoundBusinessAction,
  type TranslationContext,
} from "./types.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-21T13:00:00Z");

function money(amountMinor: number): MonetaryValue {
  return { kind: "money", amountMinor, currency: CAD };
}

function moneyRate(amountMinor: number): MonetaryRateValue {
  return {
    kind: "money_rate",
    amountMinor,
    currency: CAD,
    per: "week",
  };
}

function derivedAction(
  base: Action,
  overrides: Partial<Action>,
): Action {
  return assertValidAction({
    ...base,
    ...overrides,
  });
}

export const reduceSkuPrice899To849 = derivedAction(
  increaseGoogleShoppingBudgetBy1000,
  {
    actionId: actionId("action_sku_a_price_899_to_849"),
    actionType: actionType("pricing.adjust_price"),
    actionCategory: "pricing",
    description: "Reduce SKU A price from CAD 899 to CAD 849.",
    target: {
      kind: "sku",
      productId: "product:A",
      skuId: "sku:A",
    },
    scope: { dimensions: [] },
    parameters: {
      kind: "price_adjustment",
      operation: {
        kind: "DELTA",
        direction: "decrease",
        amount: money(5_000),
        reference: {
          kind: "explicit_baseline",
          value: money(89_900),
        },
      },
    },
    duration: { kind: "persistent" },
    termination: { kind: "persistent" },
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: {
          kind: "sku",
          productId: "product:A",
          skuId: "sku:A",
        },
        parameterKind: "price_adjustment",
      },
      minimumDelaySeconds: 0,
    },
  },
);

export const metaBudgetDown2000 = derivedAction(
  increaseGoogleShoppingBudgetBy1000,
  {
    actionId: actionId("action_meta_prospecting_budget_down_2000_week"),
    description: "Decrease Meta prospecting budget by CAD 2,000/week.",
    target: {
      kind: "campaign",
      channelId: "meta_ads",
      campaignId: "meta_prospecting",
    },
    parameters: {
      kind: "budget_adjustment",
      operation: {
        kind: "DELTA",
        direction: "decrease",
        amount: moneyRate(200_000),
        reference: {
          kind: "explicit_baseline",
          value: moneyRate(800_000),
        },
      },
    },
  },
);

export const googleBudgetUp2000 = derivedAction(
  increaseGoogleShoppingBudgetBy1000,
  {
    actionId: actionId("action_google_shopping_budget_up_2000_week"),
    description: "Increase Google Shopping budget by CAD 2,000/week.",
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
        amount: moneyRate(200_000),
        reference: {
          kind: "explicit_baseline",
          value: moneyRate(1_000_000),
        },
      },
    },
  },
);

export const budgetReallocationBusinessAction: CompoundAction = {
  kind: "compound_action",
  compoundActionId: actionId("action_reallocate_meta_to_google_2000_week"),
  schemaVersion: ACTION_SCHEMA_VERSION,
  description:
    "Move CAD 2,000/week from Meta prospecting to Google Shopping.",
  componentActionIds: [
    metaBudgetDown2000.actionId,
    googleBudgetUp2000.actionId,
  ],
};

export const resolvedBudgetReallocation: ResolvedCompoundBusinessAction = {
  kind: "resolved_compound_business_action",
  compoundAction: budgetReallocationBusinessAction,
  components: [metaBudgetDown2000, googleBudgetUp2000],
};

export const unsupportedPageChangeAction = derivedAction(
  doNothingAction,
  {
    actionId: actionId("action_unsupported_checkout_page_change"),
    actionType: actionType("cro.change_page"),
    actionCategory: "cro",
    description: "Change checkout page to variant B.",
    target: {
      kind: "page",
      pageId: "checkout",
    },
    parameters: {
      kind: "page_change",
      changeId: "checkout-layout",
      variantRef: "variant:B",
    },
    duration: { kind: "persistent" },
    termination: { kind: "persistent" },
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: {
          kind: "page",
          pageId: "checkout",
        },
        parameterKind: "page_change",
      },
      minimumDelaySeconds: 0,
    },
  },
);

export const fullTranslationContext: TranslationContext = {
  schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock: DECISION,
  capabilities: [
    "campaign_budget",
    "campaign_delivery",
    "product_price",
    "promotion_discount",
    "merchandising_position",
  ],
  entityMappings: [
    {
      actionTarget: increaseGoogleShoppingBudget20.target,
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:google_ads",
        simulatorCampaignId: "sim:google_shopping",
      },
      sourceRef: "mapping:google-shopping",
    },
    {
      actionTarget: pauseUnderperformingMetaCampaign.target,
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:meta_ads",
        simulatorCampaignId: "sim:meta_prospecting",
      },
      sourceRef: "mapping:meta-prospecting",
    },
    {
      actionTarget: reduceSkuPrice899To849.target,
      simulatorTarget: {
        kind: "sku",
        simulatorProductId: "sim:product:A",
        simulatorSkuId: "sim:sku:A",
      },
      sourceRef: "mapping:sku-a",
    },
    {
      actionTarget: runCollectionPromotion15FourDays.target,
      simulatorTarget: {
        kind: "collection",
        simulatorCollectionId: "sim:collection:A",
      },
      sourceRef: "mapping:collection-a",
    },
  ],
  referenceBindings: [
    {
      actionId: increaseGoogleShoppingBudget20.actionId,
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
      value: moneyRate(1_000_000),
      sourceRef: "observed:google-shopping-budget:2026-09-21T13:00:00Z",
    },
  ],
};

export const missingBaselineContext: TranslationContext = {
  ...fullTranslationContext,
  referenceBindings: [],
};

export {
  doNothingAction,
  increaseGoogleShoppingBudget20,
  investigateTrackingAnomaly,
  pauseUnderperformingMetaCampaign,
  runCollectionPromotion15FourDays,
  runExperimentAction,
  waitObserveAction,
};
