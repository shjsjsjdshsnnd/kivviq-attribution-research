import {
  currencyCode,
  utcTimestamp,
} from "../core/units.js";
import {
  runCollectionPromotion15FourDays as legacyPromotionFixture,
} from "../action_ontology/fixtures.js";
import {
  actionId,
  actionType,
  constraintId,
} from "../action_ontology/identity.js";
import {
  type Action,
  type ActionParameters,
  type ActionScope,
  type PromotionDefinition,
  type PromotionDiscount,
  type PromotionMembershipSemantics,
  type PromotionUsageLimits,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-21T13:00:00Z");
const FOUR_DAYS = 4 * 24 * 60 * 60;

function money(amountMinor: number) {
  return {
    kind: "money" as const,
    amountMinor,
    currency: CAD,
  };
}

function membership(
  bindingRef: string,
): PromotionMembershipSemantics {
  return {
    evaluateAt: "decision_time",
    bindingRef,
  };
}

function baseDefinition(overrides: Partial<PromotionDefinition>): PromotionDefinition {
  return {
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "PERCENTAGE",
        basisPoints: 1500,
      },
    },
    applicationScope: {
      kind: "ORDER_SCOPE",
    },
    customerEligibility: {
      kind: "ALL_CUSTOMERS",
    },
    purchaseRequirements: [],
    redemption: {
      kind: "AUTOMATIC",
    },
    usageLimits: {},
    stacking: {
      kind: "NON_STACKABLE",
    },
    conflictResolution: {
      kind: "BEST_DISCOUNT",
    },
    terminationBehavior: "DEACTIVATE_PROMOTION",
    ...overrides,
  };
}

function promotionAction(input: {
  readonly actionIdValue: string;
  readonly actionTypeValue: "promotion.start" | "promotion.stop" | "promotion.modify";
  readonly promotionId: string;
  readonly description: string;
  readonly definition?: PromotionDefinition;
  readonly duration?: Action["duration"];
  readonly termination?: Action["termination"];
  readonly timing?: Action["timing"];
  readonly constraints?: Action["constraints"];
  readonly preconditions?: Action["preconditions"];
  readonly scope?: ActionScope;
}): Action {
  const duration =
    input.duration ??
    (input.actionTypeValue === "promotion.start"
      ? ({ kind: "temporary", durationSeconds: FOUR_DAYS } as const)
      : ({ kind: "instantaneous" } as const));

  const timing =
    input.timing ??
    {
      decisionTime: DECISION,
      requestedStart: { kind: "known" as const, at: DECISION },
      effectiveStart: { kind: "known" as const, at: DECISION },
      implementationDelaySeconds: { kind: "known" as const, seconds: 0 },
    };

  const termination =
    input.termination ??
    (duration.kind === "temporary"
      ? ({
          kind: "fixed_duration",
          durationSeconds: duration.durationSeconds,
        } as const)
      : duration.kind === "persistent"
        ? ({ kind: "persistent" } as const)
        : ({
            kind: "fixed_end",
            at:
              timing.effectiveStart.kind === "known"
                ? timing.effectiveStart.at
                : DECISION,
          } as const));

  const parameters: ActionParameters =
    input.actionTypeValue === "promotion.start"
      ? {
          kind: "promotion_start",
          promotionId: input.promotionId,
          definition: input.definition!,
        }
      : input.actionTypeValue === "promotion.stop"
        ? {
            kind: "promotion_stop",
            targetPromotionId: input.promotionId,
          }
        : {
            kind: "promotion_modify",
            targetPromotionId: input.promotionId,
            definition: input.definition!,
          };

  return assertValidAction({
    ...legacyPromotionFixture,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "promotion",
    schemaVersion: "1.3.0",
    description: input.description,
    target: {
      kind: "promotion",
      promotionId: input.promotionId,
    },
    scope: input.scope ?? { dimensions: [] },
    parameters,
    timing,
    duration,
    termination,
    constraints: input.constraints ?? [],
    preconditions: input.preconditions ?? [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: {
          kind: "promotion",
          promotionId: input.promotionId,
        },
        parameterKind: parameters.kind,
      },
      minimumDelaySeconds: 0,
    },
    intent: {
      statement: "Represent an explicit merchant promotional decision.",
    },
  });
}

function percentage(basisPoints: number): PromotionDiscount {
  return {
    kind: "PERCENTAGE",
    basisPoints,
  };
}

function productScope(
  include: PromotionDefinition["applicationScope"] extends infer _T
    ? any
    : never,
) {
  return include;
}

export const startAutomaticCollectionX15FourDays = promotionAction({
  actionIdValue: "action_promo_collection_x_auto_15_4d",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_x_auto_15",
  description: "Start automatic 15% off Collection X for four days.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
  }),
});

export const startProductA100CadOff = promotionAction({
  actionIdValue: "action_promo_product_a_100_cad_off",
  actionTypeValue: "promotion.start",
  promotionId: "promo_product_a_100_cad",
  description: "Start CAD 100 off Product A.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "FIXED_AMOUNT",
        value: money(10_000),
      },
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "product", productId: "product:A" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
      },
    },
  }),
});

export const startCollectionXFall15Coupon = promotionAction({
  actionIdValue: "action_promo_collection_x_fall15",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_x_fall15",
  description: "Start 15% off Collection X with coupon FALL15.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
    redemption: {
      kind: "COUPON",
      code: "FALL15",
    },
  }),
});

export const startOrder15Above1000Cad = promotionAction({
  actionIdValue: "action_promo_order_15_above_1000",
  actionTypeValue: "promotion.start",
  promotionId: "promo_order_15_above_1000",
  description: "Start 15% off orders of at least CAD 1,000.",
  definition: baseDefinition({
    applicationScope: { kind: "ORDER_SCOPE" },
    purchaseRequirements: [
      {
        kind: "MIN_ORDER_VALUE",
        value: money(100_000),
      },
    ],
  }),
});

export const startNewCustomer20 = promotionAction({
  actionIdValue: "action_promo_new_customer_20",
  actionTypeValue: "promotion.start",
  promotionId: "promo_new_customer_20",
  description: "Start 20% off for new customers.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: percentage(2000),
    },
    customerEligibility: {
      kind: "NEW_CUSTOMERS",
    },
  }),
});

export const startVipSegmentA20 = promotionAction({
  actionIdValue: "action_promo_vip_a_20",
  actionTypeValue: "promotion.start",
  promotionId: "promo_vip_a_20",
  description: "Start 20% off for VIP Segment A.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: percentage(2000),
    },
    customerEligibility: {
      kind: "LOYALTY_SEGMENT",
      segmentId: "vip:A",
      membership: membership(
        "membership:customer-segment:vip-a:2026-09-21T13:00:00Z",
      ),
    },
  }),
});

export const startBundleAB999Cad = promotionAction({
  actionIdValue: "action_promo_bundle_ab_999",
  actionTypeValue: "promotion.start",
  promotionId: "promo_bundle_ab_999",
  description: "Start Product A plus Product B bundle for CAD 999.",
  definition: baseDefinition({
    mechanism: {
      kind: "BUNDLE_FIXED_PRICE",
      components: [
        {
          componentId: "product-a",
          target: { kind: "product", productId: "product:A" },
          quantity: 1,
        },
        {
          componentId: "product-b",
          target: { kind: "product", productId: "product:B" },
          quantity: 1,
        },
      ],
      bundlePrice: money(99_900),
    },
    applicationScope: { kind: "BUNDLE_SCOPE" },
  }),
});

export const startBundleAB15Percent = promotionAction({
  actionIdValue: "action_promo_bundle_ab_15pct",
  actionTypeValue: "promotion.start",
  promotionId: "promo_bundle_ab_15pct",
  description: "Start 15% off Product A plus Product B bundle.",
  definition: baseDefinition({
    mechanism: {
      kind: "BUNDLE_PERCENTAGE_DISCOUNT",
      components: [
        {
          componentId: "product-a",
          target: { kind: "product", productId: "product:A" },
          quantity: 1,
        },
        {
          componentId: "product-b",
          target: { kind: "product", productId: "product:B" },
          quantity: 1,
        },
      ],
      basisPoints: 1500,
    },
    applicationScope: { kind: "BUNDLE_SCOPE" },
  }),
});

export const startBuyAGet20OffB = promotionAction({
  actionIdValue: "action_promo_buy_a_get_20_off_b",
  actionTypeValue: "promotion.start",
  promotionId: "promo_buy_a_get_20_off_b",
  description: "Buy Product A and receive 20% off Product B.",
  definition: baseDefinition({
    mechanism: {
      kind: "CONDITIONAL_ITEM_DISCOUNT",
      qualifyingComponents: [
        {
          componentId: "product-a",
          target: { kind: "product", productId: "product:A" },
          quantity: 1,
        },
      ],
      rewardTarget: {
        kind: "product",
        productId: "product:B",
      },
      rewardQuantity: 1,
      discount: percentage(2000),
    },
    applicationScope: { kind: "BUNDLE_SCOPE" },
  }),
});

export const startFurniture15ExcludingBrandX = promotionAction({
  actionIdValue: "action_promo_furniture_15_exclude_brand_x",
  actionTypeValue: "promotion.start",
  promotionId: "promo_furniture_15_exclude_brand_x",
  description: "Start 15% off furniture excluding Brand X.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "category", categoryId: "category:furniture" }],
        exclude: [{ kind: "brand", brandId: "brand:X" }],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [{ kind: "NOT_CLEARANCE" }],
        membership: membership(
          "membership:promo:furniture:2026-09-21T13:00:00Z",
        ),
      },
    },
  }),
});

export const startCollection15GrossMargin30 = promotionAction({
  actionIdValue: "action_promo_collection_margin_30",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_margin_30",
  description: "Start 15% off Collection X only if post-promotion gross margin remains at least 30%.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
  }),
  constraints: [
    {
      constraintId: constraintId("promo_gross_margin_30"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.gross_margin_rate_after_promotion",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3000 },
      },
    },
  ],
  preconditions: [
    {
      preconditionId: "promo_margin_inputs_available",
      expression: {
        kind: "evidence_available",
        evidenceRef: "promotion_economics:gross_margin_inputs",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const startProductA100Contribution150 = promotionAction({
  actionIdValue: "action_promo_product_a_contribution_150",
  actionTypeValue: "promotion.start",
  promotionId: "promo_product_a_contribution_150",
  description: "Start CAD 100 off Product A only if post-promotion contribution per unit remains at least CAD 150.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "FIXED_AMOUNT",
        value: money(10_000),
      },
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "product", productId: "product:A" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
      },
    },
  }),
  constraints: [
    {
      constraintId: constraintId("promo_contribution_per_unit_150"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_per_unit_after_promotion_minor",
        operator: "GTE",
        value: money(15_000),
      },
    },
  ],
});

export const startCollection15ContributionMargin20 = promotionAction({
  actionIdValue: "action_promo_collection_contribution_margin_20",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_contribution_margin_20",
  description: "Start 15% off Collection X only if contribution margin remains at least 20%.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
  }),
  constraints: [
    {
      constraintId: constraintId("promo_contribution_margin_20"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_margin_rate_after_promotion",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 2000 },
      },
    },
  ],
  preconditions: [
    {
      preconditionId: "promo_contribution_inputs_available",
      expression: {
        kind: "evidence_available",
        evidenceRef: "promotion_economics:contribution_inputs",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

function withUsageLimits(
  promotionId: string,
  actionIdValue: string,
  usageLimits: PromotionUsageLimits,
): Action {
  return promotionAction({
    actionIdValue,
    actionTypeValue: "promotion.start",
    promotionId,
    description: "Start a limited 15% order promotion.",
    definition: baseDefinition({
      usageLimits,
    }),
  });
}

export const startOneRedemptionPerCustomer = withUsageLimits(
  "promo_one_per_customer",
  "action_promo_one_per_customer",
  { maxRedemptionsPerCustomer: 1 },
);

export const startFirst500Redemptions = withUsageLimits(
  "promo_first_500",
  "action_promo_first_500",
  { maxTotalRedemptions: 500 },
);

export const startSkuAFixedPromotionalPrice749 = promotionAction({
  actionIdValue: "action_promo_sku_a_fixed_price_749",
  actionTypeValue: "promotion.start",
  promotionId: "promo_sku_a_fixed_price_749",
  description: "Start a fixed promotional price of CAD 749 for SKU A.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "FIXED_PROMOTIONAL_PRICE",
        value: money(74_900),
      },
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "sku", skuId: "sku:A", productId: "product:A" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
      },
    },
  }),
});

export const stopCollectionXAutomatic15 = promotionAction({
  actionIdValue: "action_promo_stop_collection_x_auto_15",
  actionTypeValue: "promotion.stop",
  promotionId: "promo_collection_x_auto_15",
  description: "Stop Promotion promo_collection_x_auto_15 immediately.",
});

export const modifyCollectionX15To20 = promotionAction({
  actionIdValue: "action_promo_modify_collection_x_15_to_20",
  actionTypeValue: "promotion.modify",
  promotionId: "promo_collection_x_auto_15",
  description: "Modify active Collection X promotion from 15% to 20%.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: percentage(2000),
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
  }),
});

export const overlappingFurniture15NonStackable = startFurniture15ExcludingBrandX;

export const overlappingCollection20NonStackable = promotionAction({
  actionIdValue: "action_promo_collection_x_20_nonstackable",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_x_20_nonstackable",
  description: "Start non-stackable 20% off Collection X without explicit overlap resolution.",
  definition: baseDefinition({
    mechanism: {
      kind: "DISCOUNT",
      discount: percentage(2000),
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [{ kind: "collection", collectionId: "collection:X" }],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        ),
      },
    },
    stacking: { kind: "NON_STACKABLE" },
    conflictResolution: { kind: "NONE" },
  }),
});

export const collectionPromotionMissingMembershipBinding = promotionAction({
  actionIdValue: "action_promo_collection_missing_membership",
  actionTypeValue: "promotion.start",
  promotionId: "promo_collection_missing_membership",
  description: "Start 15% off Collection Missing with a binding unavailable to translation.",
  definition: baseDefinition({
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [
          { kind: "collection", collectionId: "collection:missing" },
        ],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
        membership: membership(
          "membership:promo:collection-missing:decision",
        ),
      },
    },
  }),
});

export const invalidPercentagePromotion: unknown = {
  ...startAutomaticCollectionX15FourDays,
  actionId: "action_promo_invalid_percentage",
  parameters: {
    kind: "promotion_start",
    promotionId: "promo_invalid_percentage",
    definition: {
      ...(startAutomaticCollectionX15FourDays.parameters.kind === "promotion_start"
        ? startAutomaticCollectionX15FourDays.parameters.definition
        : {}),
      mechanism: {
        kind: "DISCOUNT",
        discount: {
          kind: "PERCENTAGE",
          basisPoints: 12_000,
        },
      },
    },
  },
  target: {
    kind: "promotion",
    promotionId: "promo_invalid_percentage",
  },
};

export const automaticVsCouponPair = {
  automatic: startAutomaticCollectionX15FourDays,
  coupon: startCollectionXFall15Coupon,
} as const;
