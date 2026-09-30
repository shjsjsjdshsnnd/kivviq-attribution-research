import { currencyCode, utcTimestamp } from "../core/units.js";
import {
  increaseGoogleShoppingBudget20 as step1GoogleBudgetFixture,
} from "../action_ontology/fixtures.js";
import {
  actionId,
  actionType,
  constraintId,
} from "../action_ontology/identity.js";
import type {
  Action,
  ActionParameters,
  ActionScope,
  ActionTarget,
  CompoundAction,
  MonetaryRateValue,
} from "../action_ontology/types.js";
import {
  ACTION_SCHEMA_VERSION,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import type { PaidMediaReallocationBundle } from "./types.js";
import { validatePaidMediaReallocation } from "./reallocation.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-21T13:00:00Z");

function moneyRate(
  amountMinor: number,
  per: "day" | "week" | "month",
): MonetaryRateValue {
  return {
    kind: "money_rate",
    amountMinor,
    currency: CAD,
    per,
  };
}

function segmentScope(
  classification:
    | "prospecting"
    | "retargeting"
    | "brand"
    | "non_brand"
    | "custom",
  segmentId?: string,
): ActionScope {
  return {
    dimensions: [
      {
        kind: "paid_media_segment",
        classification,
        taxonomySource: "kivviq_canonical",
        ...(segmentId ? { segmentId } : {}),
      },
    ],
  };
}

function paidMediaAction(
  input: {
    readonly actionIdValue: string;
    readonly actionTypeValue: string;
    readonly description: string;
    readonly target: ActionTarget;
    readonly parameters: ActionParameters;
    readonly scope?: ActionScope;
    readonly constraints?: Action["constraints"];
    readonly preconditions?: Action["preconditions"];
    readonly timing?: Action["timing"];
    readonly duration?: Action["duration"];
    readonly termination?: Action["termination"];
    readonly intent?: string;
  },
): Action {
  const scope = input.scope ?? { dimensions: [] };
  const duration = input.duration ?? { kind: "persistent" as const };
  const termination =
    input.termination ??
    (duration.kind === "until_reversed"
      ? ({ kind: "manual_reversal" } as const)
      : duration.kind === "temporary"
        ? ({
            kind: "fixed_duration",
            durationSeconds: duration.durationSeconds,
          } as const)
        : ({ kind: "persistent" } as const));

  return assertValidAction({
    ...step1GoogleBudgetFixture,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "advertising",
    schemaVersion: "1.1.0",
    description: input.description,
    target: input.target,
    scope,
    parameters: input.parameters,
    timing:
      input.timing ??
      {
        decisionTime: DECISION,
        requestedStart: { kind: "known", at: DECISION },
        effectiveStart: { kind: "known", at: DECISION },
        implementationDelaySeconds: { kind: "known", seconds: 0 },
      },
    duration,
    termination,
    constraints: input.constraints ?? [],
    preconditions: input.preconditions ?? [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: input.target,
        parameterKind: input.parameters.kind,
      },
      minimumDelaySeconds: 0,
    },
    intent: {
      statement:
        input.intent ?? "Represent an explicit paid-media business decision.",
    },
  });
}

function budgetMultiplier(
  factor: number,
): ActionParameters {
  return {
    kind: "budget_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor,
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  };
}

function budgetDelta(
  direction: "increase" | "decrease",
  amountMinor: number,
  per: "day" | "week" | "month",
  baselineMinor: number,
): ActionParameters {
  return {
    kind: "budget_adjustment",
    operation: {
      kind: "DELTA",
      direction,
      amount: moneyRate(amountMinor, per),
      reference: {
        kind: "explicit_baseline",
        value: moneyRate(baselineMinor, per),
      },
    },
  };
}

function budgetSet(
  amountMinor: number,
  per: "day" | "week" | "month",
): ActionParameters {
  return {
    kind: "budget_adjustment",
    operation: {
      kind: "SET",
      value: moneyRate(amountMinor, per),
    },
  };
}

function delivery(
  operation: "PAUSE" | "RESUME",
): ActionParameters {
  return {
    kind: "paid_media_delivery",
    operation,
  };
}

function bundle(
  id: string,
  description: string,
  components: readonly Action[],
  fundingPolicy: PaidMediaReallocationBundle["fundingPolicy"] = {
    kind: "pure_reallocation",
  },
): PaidMediaReallocationBundle {
  const compoundAction: CompoundAction = {
    kind: "compound_action",
    compoundActionId: actionId(id),
    schemaVersion: "1.1.0",
    description,
    componentActionIds: components.map((component) => component.actionId),
  };

  const candidate: PaidMediaReallocationBundle = {
    kind: "paid_media_reallocation_bundle",
    compoundAction,
    components,
    fundingPolicy,
  };
  const result = validatePaidMediaReallocation(candidate);
  if (!result.ok) {
    throw new Error(
      "Invalid paid-media fixture: " +
        result.errors.map((issue) => issue.code).join(", "),
    );
  }
  return candidate;
}

export const increaseGoogleShoppingBudget20 = paidMediaAction({
  actionIdValue: "action_pm_google_shopping_budget_up_20pct",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Google Shopping budget by 20%.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_shopping",
  },
  parameters: budgetMultiplier(1.2),
});

export const decreaseMetaProspectingBudget500PerDay = paidMediaAction({
  actionIdValue: "action_pm_meta_prospecting_down_500_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease Meta prospecting budget by CAD 500/day.",
  target: {
    kind: "advertising_channel",
    channelId: "meta_ads",
  },
  scope: segmentScope("prospecting", "meta:prospecting"),
  parameters: budgetDelta("decrease", 50_000, "day", 200_000),
});

export const setPinterestBudget300PerDay = paidMediaAction({
  actionIdValue: "action_pm_pinterest_budget_set_300_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Set Pinterest budget to CAD 300/day.",
  target: {
    kind: "advertising_channel",
    channelId: "pinterest_ads",
  },
  parameters: budgetSet(30_000, "day"),
});

export const pauseMetaCampaignA = paidMediaAction({
  actionIdValue: "action_pm_pause_meta_campaign_a",
  actionTypeValue: "advertising.set_delivery_state",
  description: "Pause Meta Campaign A.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "meta_campaign_a",
  },
  parameters: delivery("PAUSE"),
  duration: { kind: "until_reversed" },
});

export const resumeGoogleCampaignB = paidMediaAction({
  actionIdValue: "action_pm_resume_google_campaign_b",
  actionTypeValue: "advertising.set_delivery_state",
  description: "Resume Google Campaign B.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_campaign_b",
  },
  parameters: delivery("RESUME"),
});

const metaChannelDown2000Week = paidMediaAction({
  actionIdValue: "action_pm_meta_down_2000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease Meta budget by CAD 2,000/week.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: budgetDelta("decrease", 200_000, "week", 800_000),
});

const googleChannelUp2000Week = paidMediaAction({
  actionIdValue: "action_pm_google_up_2000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Google budget by CAD 2,000/week.",
  target: { kind: "advertising_channel", channelId: "google_ads" },
  parameters: budgetDelta("increase", 200_000, "week", 1_000_000),
});

export const metaToGoogle2000PerWeek = bundle(
  "action_pm_reallocate_meta_google_2000_week",
  "Move CAD 2,000/week from Meta to Google.",
  [metaChannelDown2000Week, googleChannelUp2000Week],
);

const metaCampaignADown500Day = paidMediaAction({
  actionIdValue: "action_pm_meta_campaign_a_down_500_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease Meta Campaign A budget by CAD 500/day.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "meta_campaign_a",
  },
  parameters: budgetDelta("decrease", 50_000, "day", 150_000),
});

const metaCampaignBUp500Day = paidMediaAction({
  actionIdValue: "action_pm_meta_campaign_b_up_500_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Meta Campaign B budget by CAD 500/day.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "meta_campaign_b",
  },
  parameters: budgetDelta("increase", 50_000, "day", 100_000),
});

export const metaCampaignAtoB500PerDay = bundle(
  "action_pm_reallocate_meta_campaign_a_b_500_day",
  "Move CAD 500/day from Meta Campaign A to Meta Campaign B.",
  [metaCampaignADown500Day, metaCampaignBUp500Day],
);

const metaRetargetingDown1000Week = paidMediaAction({
  actionIdValue: "action_pm_meta_retargeting_down_1000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease Meta retargeting budget by CAD 1,000/week.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  scope: segmentScope("retargeting", "meta:retargeting"),
  parameters: budgetDelta("decrease", 100_000, "week", 250_000),
});

const metaProspectingUp1000Week = paidMediaAction({
  actionIdValue: "action_pm_meta_prospecting_up_1000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Meta prospecting budget by CAD 1,000/week.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  scope: segmentScope("prospecting", "meta:prospecting"),
  parameters: budgetDelta("increase", 100_000, "week", 500_000),
});

export const metaRetargetingToProspecting1000PerWeek = bundle(
  "action_pm_reallocate_meta_retargeting_prospecting_1000_week",
  "Move CAD 1,000/week from Meta retargeting to Meta prospecting.",
  [metaRetargetingDown1000Week, metaProspectingUp1000Week],
);

export const metaProspectingRetargeting75_25 = paidMediaAction({
  actionIdValue: "action_pm_meta_allocation_75_25",
  actionTypeValue: "advertising.set_allocation",
  description:
    "Shift Meta allocation from 60% prospecting / 40% retargeting to 75% / 25%.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: {
    kind: "paid_media_allocation",
    control: "budget",
    operation: "SET",
    denominator: {
      kind: "target_scope",
      control: "budget",
      target: { kind: "advertising_channel", channelId: "meta_ads" },
      scope: { dimensions: [] },
    },
    baselineShares: [
      {
        memberId: "prospecting",
        member: {
          kind: "strategy",
          classification: "prospecting",
          segmentId: "meta:prospecting",
        },
        shareBasisPoints: 6000,
      },
      {
        memberId: "retargeting",
        member: {
          kind: "strategy",
          classification: "retargeting",
          segmentId: "meta:retargeting",
        },
        shareBasisPoints: 4000,
      },
    ],
    shares: [
      {
        memberId: "prospecting",
        member: {
          kind: "strategy",
          classification: "prospecting",
          segmentId: "meta:prospecting",
        },
        shareBasisPoints: 7500,
      },
      {
        memberId: "retargeting",
        member: {
          kind: "strategy",
          classification: "retargeting",
          segmentId: "meta:retargeting",
        },
        shareBasisPoints: 2500,
      },
    ],
  },
});

const googleBrandDown300Day = paidMediaAction({
  actionIdValue: "action_pm_google_brand_down_300_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease Google Brand budget by CAD 300/day.",
  target: { kind: "advertising_channel", channelId: "google_ads" },
  scope: segmentScope("brand", "google:brand"),
  parameters: budgetDelta("decrease", 30_000, "day", 80_000),
  preconditions: [
    {
      preconditionId: "google_brand_classification_known",
      expression: {
        kind: "evidence_available",
        evidenceRef: "paid_media.classification:google:brand",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

const googleNonBrandUp300Day = paidMediaAction({
  actionIdValue: "action_pm_google_nonbrand_up_300_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Google Non-Brand budget by CAD 300/day.",
  target: { kind: "advertising_channel", channelId: "google_ads" },
  scope: segmentScope("non_brand", "google:non_brand"),
  parameters: budgetDelta("increase", 30_000, "day", 200_000),
  preconditions: [
    {
      preconditionId: "google_nonbrand_classification_known",
      expression: {
        kind: "evidence_available",
        evidenceRef: "paid_media.classification:google:non_brand",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const googleBrandToNonBrand300PerDay = bundle(
  "action_pm_reallocate_google_brand_nonbrand_300_day",
  "Move CAD 300/day from Google Brand to Google Non-Brand.",
  [googleBrandDown300Day, googleNonBrandUp300Day],
);

export const googleBrandNonBrand15_85 = paidMediaAction({
  actionIdValue: "action_pm_google_search_allocation_15_85",
  actionTypeValue: "advertising.set_allocation",
  description: "Set Google Search allocation to 15% Brand / 85% Non-Brand.",
  target: { kind: "advertising_channel", channelId: "google_ads" },
  parameters: {
    kind: "paid_media_allocation",
    control: "budget",
    operation: "SET",
    denominator: {
      kind: "target_scope",
      control: "budget",
      target: { kind: "advertising_channel", channelId: "google_ads" },
      scope: { dimensions: [] },
    },
    shares: [
      {
        memberId: "brand",
        member: {
          kind: "traffic_classification",
          classification: "brand",
          segmentId: "google:brand",
        },
        shareBasisPoints: 1500,
      },
      {
        memberId: "non_brand",
        member: {
          kind: "traffic_classification",
          classification: "non_brand",
          segmentId: "google:non_brand",
        },
        shareBasisPoints: 8500,
      },
    ],
  },
  preconditions: [
    {
      preconditionId: "google_search_classification_known",
      expression: {
        kind: "evidence_available",
        evidenceRef: "paid_media.classification:google_search",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const increaseSkuAAdvertising20 = paidMediaAction({
  actionIdValue: "action_pm_sku_a_budget_up_20pct",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase paid-media budget for SKU A by 20%.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: budgetMultiplier(1.2),
});

export const pauseLowInventorySkuB = paidMediaAction({
  actionIdValue: "action_pm_pause_low_inventory_sku_b",
  actionTypeValue: "advertising.set_delivery_state",
  description: "Pause paid advertising for SKU B if inventory is below 10 units.",
  target: { kind: "sku", productId: "product:B", skuId: "sku:B" },
  parameters: delivery("PAUSE"),
  constraints: [
    {
      constraintId: constraintId("sku_b_inventory_below_10"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "inventory.available_units",
        operator: "LT",
        value: { kind: "quantity", value: 10, unit: "units" },
      },
    },
  ],
});

const rugsDown1000Week = paidMediaAction({
  actionIdValue: "action_pm_rugs_down_1000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Decrease paid-media budget for Rugs by CAD 1,000/week.",
  target: { kind: "collection", collectionId: "collection:rugs" },
  parameters: budgetDelta("decrease", 100_000, "week", 300_000),
});

const lightingUp1000Week = paidMediaAction({
  actionIdValue: "action_pm_lighting_up_1000_week",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase paid-media budget for Lighting by CAD 1,000/week.",
  target: { kind: "collection", collectionId: "collection:lighting" },
  parameters: budgetDelta("increase", 100_000, "week", 250_000),
});

export const rugsToLighting1000PerWeek = bundle(
  "action_pm_reallocate_rugs_lighting_1000_week",
  "Move CAD 1,000/week of advertising budget from Rugs to Lighting.",
  [rugsDown1000Week, lightingUp1000Week],
);

export const increaseProductWithContributionMarginFloor = paidMediaAction({
  actionIdValue: "action_pm_product_a_budget_up_margin_floor",
  actionTypeValue: "advertising.adjust_budget",
  description:
    "Increase Product A paid-media budget by 15% only while contribution margin is at least 30%.",
  target: { kind: "product", productId: "product:A" },
  parameters: budgetMultiplier(1.15),
  constraints: [
    {
      constraintId: constraintId("product_a_contribution_margin_floor"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3000 },
      },
    },
  ],
});

export const blackFridayProspectingFourDays = paidMediaAction({
  actionIdValue: "action_pm_black_friday_prospecting_plus_1500_day",
  actionTypeValue: "advertising.adjust_budget",
  description:
    "Increase Black Friday Meta prospecting budget by CAD 1,500/day for four days.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  scope: segmentScope("prospecting", "meta:prospecting"),
  parameters: budgetDelta("increase", 150_000, "day", 300_000),
  timing: {
    decisionTime: utcTimestamp("2026-11-23T13:00:00Z"),
    requestedStart: {
      kind: "known",
      at: utcTimestamp("2026-11-27T05:00:00Z"),
    },
    effectiveStart: {
      kind: "known",
      at: utcTimestamp("2026-11-27T05:00:00Z"),
    },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
  duration: { kind: "temporary", durationSeconds: 4 * 24 * 60 * 60 },
});

export const unsupportedTikTokSpendCap = paidMediaAction({
  actionIdValue: "action_pm_tiktok_spend_cap_1000_day",
  actionTypeValue: "advertising.adjust_spend_cap",
  description: "Set TikTok account spend cap to CAD 1,000/day.",
  target: {
    kind: "advertising_account",
    channelId: "tiktok_ads",
    accountId: "tiktok:account:synthetic",
  },
  parameters: {
    kind: "spend_cap_adjustment",
    operation: {
      kind: "SET",
      value: moneyRate(100_000, "day"),
    },
  },
});

const pinterestTenPercentSource = paidMediaAction({
  actionIdValue: "action_pm_pinterest_transfer_source_10pct",
  actionTypeValue: "advertising.transfer_budget_leg",
  description: "Transfer 10% of Pinterest budget away from Pinterest.",
  target: { kind: "advertising_channel", channelId: "pinterest_ads" },
  parameters: {
    kind: "paid_media_transfer_leg",
    transferId: "transfer:pinterest-meta:10pct",
    role: "source",
    control: "budget",
    operation: "DELTA",
    direction: "decrease",
    amount: {
      kind: "percentage_of_source",
      basisPoints: 1000,
      sourceTarget: { kind: "advertising_channel", channelId: "pinterest_ads" },
      sourceScope: { dimensions: [] },
      sourceReference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
});

const metaTenPercentDestination = paidMediaAction({
  actionIdValue: "action_pm_meta_transfer_destination_10pct",
  actionTypeValue: "advertising.transfer_budget_leg",
  description: "Receive 10% of Pinterest budget into Meta.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: {
    kind: "paid_media_transfer_leg",
    transferId: "transfer:pinterest-meta:10pct",
    role: "destination",
    control: "budget",
    operation: "DELTA",
    direction: "increase",
    amount: {
      kind: "percentage_of_source",
      basisPoints: 1000,
      sourceTarget: { kind: "advertising_channel", channelId: "pinterest_ads" },
      sourceScope: { dimensions: [] },
      sourceReference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
});

export const pinterestToMetaTenPercent = bundle(
  "action_pm_reallocate_pinterest_meta_10pct",
  "Move 10% of paid-media budget from Pinterest to Meta.",
  [pinterestTenPercentSource, metaTenPercentDestination],
);

const googleCampaignXSource20 = paidMediaAction({
  actionIdValue: "action_pm_google_campaign_x_source_20pct",
  actionTypeValue: "advertising.transfer_budget_leg",
  description: "Transfer 20% of Google Non-Brand Campaign X budget away.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_nonbrand_x",
  },
  scope: segmentScope("non_brand", "google:non_brand"),
  parameters: {
    kind: "paid_media_transfer_leg",
    transferId: "transfer:google-x-y:20pct",
    role: "source",
    control: "budget",
    operation: "DELTA",
    direction: "decrease",
    amount: {
      kind: "percentage_of_source",
      basisPoints: 2000,
      sourceTarget: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_nonbrand_x",
      },
      sourceScope: segmentScope("non_brand", "google:non_brand"),
      sourceReference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
});

const googleCampaignYDestination20 = paidMediaAction({
  actionIdValue: "action_pm_google_campaign_y_destination_20pct",
  actionTypeValue: "advertising.transfer_budget_leg",
  description: "Receive 20% of Google Non-Brand Campaign X budget into Campaign Y.",
  target: {
    kind: "campaign",
    channelId: "google_ads",
    campaignId: "google_nonbrand_y",
  },
  scope: segmentScope("non_brand", "google:non_brand"),
  parameters: {
    kind: "paid_media_transfer_leg",
    transferId: "transfer:google-x-y:20pct",
    role: "destination",
    control: "budget",
    operation: "DELTA",
    direction: "increase",
    amount: {
      kind: "percentage_of_source",
      basisPoints: 2000,
      sourceTarget: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_nonbrand_x",
      },
      sourceScope: segmentScope("non_brand", "google:non_brand"),
      sourceReference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
    },
  },
});

export const googleNonBrandCampaignXtoY20Percent = bundle(
  "action_pm_reallocate_google_nonbrand_x_y_20pct",
  "Move 20% of Google Non-Brand Campaign X budget to Campaign Y.",
  [googleCampaignXSource20, googleCampaignYDestination20],
);

export const increaseMeta500PerDay = paidMediaAction({
  actionIdValue: "action_pm_meta_increase_500_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Meta budget by CAD 500/day.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: budgetDelta("increase", 50_000, "day", 200_000),
});

export const setMeta500PerDay = paidMediaAction({
  actionIdValue: "action_pm_meta_set_500_day",
  actionTypeValue: "advertising.adjust_budget",
  description: "Set Meta budget to CAD 500/day.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: budgetSet(50_000, "day"),
});

export const increaseMeta20Percent = paidMediaAction({
  actionIdValue: "action_pm_meta_increase_20pct",
  actionTypeValue: "advertising.adjust_budget",
  description: "Increase Meta budget by 20%.",
  target: { kind: "advertising_channel", channelId: "meta_ads" },
  parameters: budgetMultiplier(1.2),
});

export const setMetaCampaignBudgetZero = paidMediaAction({
  actionIdValue: "action_pm_meta_campaign_a_budget_zero",
  actionTypeValue: "advertising.adjust_budget",
  description: "Set Meta Campaign A budget to CAD 0/day.",
  target: {
    kind: "campaign",
    channelId: "meta_ads",
    campaignId: "meta_campaign_a",
  },
  parameters: budgetSet(0, "day"),
});
