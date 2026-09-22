import { currencyCode, utcTimestamp } from "../core/units.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import {
  actionId,
  actionType,
  constraintId,
} from "../action_ontology/identity.js";
import type {
  Action,
  ActionParameters,
  ActionTarget,
  MerchandisingConflictResolution,
  MerchandisingEntityTarget,
  MerchandisingPlacement,
  MerchandisingSurface,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import type {
  MerchandisingRankingSnapshot,
  MerchandisingSurfaceDefinition,
} from "./types.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-22T13:00:00Z");
const FOUR_DAYS = 4 * 24 * 60 * 60;

const coexist: MerchandisingConflictResolution = { kind: "COEXIST" };

function merchandisingAction(input: {
  readonly actionIdValue: string;
  readonly actionTypeValue:
    | "merchandising.feature"
    | "merchandising.deprioritize"
    | "merchandising.set_rank"
    | "merchandising.promote_substitute"
    | "merchandising.set_cross_sell"
    | "merchandising.set_upsell"
    | "merchandising.remove_placement"
    | "merchandising.remove_relationship"
    | "merchandising.rollback_rank";
  readonly target: ActionTarget;
  readonly description: string;
  readonly parameters: ActionParameters;
  readonly duration?: Action["duration"];
  readonly termination?: Action["termination"];
  readonly timing?: Action["timing"];
  readonly constraints?: Action["constraints"];
  readonly preconditions?: Action["preconditions"];
  readonly merchandisingRollback?: NonNullable<
    Action["reversibility"]["merchandisingRollback"]
  >;
  readonly reversalOfActionId?: Action["reversalOfActionId"];
  readonly scope?: Action["scope"];
}): Action {
  const duration =
    input.duration ??
    (input.actionTypeValue === "merchandising.remove_placement" ||
    input.actionTypeValue === "merchandising.remove_relationship" ||
    input.actionTypeValue === "merchandising.rollback_rank"
      ? ({ kind: "instantaneous" } as const)
      : ({ kind: "persistent" } as const));
  const timing =
    input.timing ??
    ({
      decisionTime: DECISION,
      requestedStart: { kind: "known", at: DECISION },
      effectiveStart: { kind: "known", at: DECISION },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    } as const);
  const termination =
    input.termination ??
    (duration.kind === "temporary"
      ? ({
          kind: "fixed_duration",
          durationSeconds: duration.durationSeconds,
        } as const)
      : duration.kind === "instantaneous"
        ? ({
            kind: "fixed_end",
            at:
              timing.effectiveStart.kind === "known"
                ? timing.effectiveStart.at
                : DECISION,
          } as const)
        : ({ kind: "persistent" } as const));

  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "merchandising",
    schemaVersion: "1.5.0",
    description: input.description,
    target: input.target,
    scope: input.scope ?? { dimensions: [] },
    parameters: input.parameters,
    timing,
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
      ...(input.merchandisingRollback
        ? { merchandisingRollback: input.merchandisingRollback }
        : {}),
    },
    ...(input.reversalOfActionId
      ? { reversalOfActionId: input.reversalOfActionId }
      : {}),
    intent: {
      statement: "Represent an explicit onsite merchandising business decision.",
    },
  });
}

const product = (productId: string): Extract<ActionTarget, { kind: "product" }> => ({
  kind: "product",
  productId,
});
const collection = (
  collectionId: string,
): Extract<ActionTarget, { kind: "collection" }> => ({
  kind: "collection",
  collectionId,
});

const collectionSurface = (
  collectionId: string,
): MerchandisingSurface => ({
  kind: "COLLECTION_PAGE",
  collectionId,
});

const homepage = (areaId = "featured"): MerchandisingSurface => ({
  kind: "HOMEPAGE",
  areaId,
});

function feature(
  id: string,
  actionIdValue: string,
  entity: MerchandisingEntityTarget,
  surface: MerchandisingSurface,
  placement: MerchandisingPlacement,
  opts: Partial<Parameters<typeof merchandisingAction>[0]> = {},
): Action {
  return merchandisingAction({
    actionIdValue,
    actionTypeValue: "merchandising.feature",
    target: entity,
    description: "Feature a merchandising entity on a structured surface.",
    parameters: {
      kind: "merchandising_visibility",
      entity,
      surface,
      placementId: id,
      placement,
      visibility: { kind: "FEATURE" },
      conflictResolution: coexist,
    },
    ...opts,
  } as any);
}

export const featureProductAHomepage = feature(
  "merchplace_home_product_a",
  "action_merch_feature_product_a_home",
  product("product:A"),
  homepage(),
  { kind: "POSITION", position: 1 },
);

export const featureCollectionXHomepageSlot1 = feature(
  "merchplace_home_collection_x",
  "action_merch_feature_collection_x_home",
  collection("collection:X"),
  homepage("hero"),
  { kind: "NAMED_SLOT", slotId: "hero-1" },
);

export const deprioritizeProductBCollectionY = merchandisingAction({
  actionIdValue: "action_merch_deprioritize_product_b_collection_y",
  actionTypeValue: "merchandising.deprioritize",
  target: product("product:B"),
  description: "Deprioritize Product B in Collection Y below the first 20 results.",
  parameters: {
    kind: "merchandising_visibility",
    entity: product("product:B"),
    surface: collectionSurface("collection:Y"),
    visibility: { kind: "DEPRIORITIZE", belowPosition: 20 },
    conflictResolution: coexist,
  },
});

export const setProductCPosition1CollectionX = merchandisingAction({
  actionIdValue: "action_merch_product_c_set_rank_1_collection_x",
  actionTypeValue: "merchandising.set_rank",
  target: product("product:C"),
  description: "Set Product C to position 1 in Collection X.",
  parameters: {
    kind: "merchandising_rank",
    entity: product("product:C"),
    surface: collectionSurface("collection:X"),
    operation: { kind: "SET", position: 1 },
    displacement: "SHIFT_OTHERS",
    conflictResolution: coexist,
  },
});

export const moveProductDFrom12To3 = merchandisingAction({
  actionIdValue: "action_merch_product_d_move_12_to_3",
  actionTypeValue: "merchandising.set_rank",
  target: product("product:D"),
  description: "Move Product D from position 12 to position 3 in Collection X.",
  parameters: {
    kind: "merchandising_rank",
    entity: product("product:D"),
    surface: collectionSurface("collection:X"),
    operation: {
      kind: "DELTA",
      direction: "UP",
      positions: 9,
      snapshot: {
        bindingRef: "ranking:collection-x:d-at-12",
        evaluateAt: "decision_time",
      },
    },
    displacement: "SHIFT_OTHERS",
    conflictResolution: coexist,
  },
});

export const moveProductEUpFive = merchandisingAction({
  actionIdValue: "action_merch_product_e_up_5",
  actionTypeValue: "merchandising.set_rank",
  target: product("product:E"),
  description: "Move Product E up five positions using an explicit ranking snapshot.",
  parameters: {
    kind: "merchandising_rank",
    entity: product("product:E"),
    surface: collectionSurface("collection:X"),
    operation: {
      kind: "DELTA",
      direction: "UP",
      positions: 5,
      snapshot: {
        bindingRef: "ranking:collection-x:e-relative",
        evaluateAt: "decision_time",
      },
    },
    displacement: "SHIFT_OTHERS",
    conflictResolution: coexist,
  },
});

function relationshipAction(input: {
  actionIdValue: string;
  actionTypeValue:
    | "merchandising.promote_substitute"
    | "merchandising.set_cross_sell"
    | "merchandising.set_upsell";
  relationshipId: string;
  relationshipType: "SUBSTITUTE" | "CROSS_SELL" | "UPSELL";
  source: Extract<ActionTarget, { kind: "product" | "sku" }>;
  targets: readonly {
    readonly entity: Extract<ActionTarget, { kind: "product" | "sku" }>;
    readonly position: number;
  }[];
  surface: MerchandisingSurface;
  trigger?: ActionParameters extends infer _T ? any : never;
  constraints?: Action["constraints"];
}): Action {
  return merchandisingAction({
    actionIdValue: input.actionIdValue,
    actionTypeValue: input.actionTypeValue,
    target: {
      kind: "merchandising_relationship",
      relationshipId: input.relationshipId,
    },
    description: "Create a directional merchandising relationship placement.",
    parameters: {
      kind: "merchandising_relationship",
      relationshipType: input.relationshipType,
      source: input.source,
      targets: input.targets,
      surface: input.surface,
      trigger: input.trigger ?? { kind: "ALWAYS" },
      conflictResolution: coexist,
    },
    ...(input.constraints ? { constraints: input.constraints } : {}),
  });
}

export const promoteProductBSubstituteForA = relationshipAction({
  actionIdValue: "action_merch_substitute_a_to_b",
  actionTypeValue: "merchandising.promote_substitute",
  relationshipId: "merchrel_substitute_a_b",
  relationshipType: "SUBSTITUTE",
  source: product("product:A"),
  targets: [{ entity: product("product:B"), position: 1 }],
  surface: {
    kind: "PRODUCT_PAGE",
    productId: "product:A",
  },
});

export const promoteProductBSubstituteWhenAOutOfStock = relationshipAction({
  actionIdValue: "action_merch_substitute_a_to_b_oos",
  actionTypeValue: "merchandising.promote_substitute",
  relationshipId: "merchrel_substitute_a_b_oos",
  relationshipType: "SUBSTITUTE",
  source: product("product:A"),
  targets: [{ entity: product("product:B"), position: 1 }],
  surface: {
    kind: "PRODUCT_PAGE",
    productId: "product:A",
  },
  trigger: { kind: "SOURCE_OUT_OF_STOCK" },
});

export const crossSellCushionBForSofaA = relationshipAction({
  actionIdValue: "action_merch_cross_sell_sofa_a_cushion_b",
  actionTypeValue: "merchandising.set_cross_sell",
  relationshipId: "merchrel_cross_sofa_a_cushion_b",
  relationshipType: "CROSS_SELL",
  source: product("product:sofa-a"),
  targets: [{ entity: product("product:cushion-b"), position: 1 }],
  surface: {
    kind: "PRODUCT_PAGE",
    productId: "product:sofa-a",
  },
});

export const orderedCrossSellSetForSofaA = relationshipAction({
  actionIdValue: "action_merch_cross_sell_sofa_a_ordered_set",
  actionTypeValue: "merchandising.set_cross_sell",
  relationshipId: "merchrel_cross_sofa_a_set",
  relationshipType: "CROSS_SELL",
  source: product("product:sofa-a"),
  targets: [
    { entity: product("product:side-table-c"), position: 1 },
    { entity: product("product:cushion-b"), position: 2 },
    { entity: product("product:throw-d"), position: 3 },
  ],
  surface: {
    kind: "RECOMMENDATION_SLOT",
    slotGroupId: "pdp-related",
  },
});

export const upsellPremiumSofaBFromSofaA = relationshipAction({
  actionIdValue: "action_merch_upsell_sofa_a_premium_b",
  actionTypeValue: "merchandising.set_upsell",
  relationshipId: "merchrel_upsell_sofa_a_premium_b",
  relationshipType: "UPSELL",
  source: product("product:sofa-a"),
  targets: [{ entity: product("product:premium-sofa-b"), position: 1 }],
  surface: {
    kind: "PRODUCT_PAGE",
    productId: "product:sofa-a",
  },
});

export const featureProductAInventory20 = feature(
  "merchplace_inventory_product_a",
  "action_merch_feature_product_a_inventory_20",
  product("product:A"),
  homepage(),
  { kind: "POSITION", position: 2 },
  {
    constraints: [
      {
        constraintId: constraintId("merch_inventory_product_a_20"),
        constraintClass: "hard",
        expression: {
          kind: "property_comparison",
          propertyId: "inventory.available_units",
          operator: "GTE",
          value: { kind: "quantity", value: 20, unit: "units" },
        },
      },
    ],
  },
);

export const featureProductAContribution100 = feature(
  "merchplace_contribution_product_a",
  "action_merch_feature_product_a_contribution_100",
  product("product:A"),
  homepage(),
  { kind: "POSITION", position: 3 },
  {
    constraints: [
      {
        constraintId: constraintId("merch_product_a_contribution_100"),
        constraintClass: "hard",
        expression: {
          kind: "property_comparison",
          propertyId: "finance.contribution_per_unit_minor",
          operator: "GTE",
          value: {
            kind: "money",
            amountMinor: 10_000,
            currency: CAD,
          },
        },
      },
    ],
    preconditions: [
      {
        preconditionId: "product_a_contribution_available",
        expression: {
          kind: "evidence_available",
          evidenceRef: "product_economics:contribution:product:A",
        },
        whenUnknown: "unknown_eligibility",
      },
    ],
  },
);

export const temporaryProductAPosition1FourDays = merchandisingAction({
  actionIdValue: "action_merch_product_a_position_1_temp_4d",
  actionTypeValue: "merchandising.set_rank",
  target: product("product:A"),
  description: "Temporarily move Product A to Collection X position 1 for four days.",
  parameters: {
    kind: "merchandising_rank",
    entity: product("product:A"),
    surface: collectionSurface("collection:X"),
    operation: { kind: "SET", position: 1 },
    displacement: "SHIFT_OTHERS",
    conflictResolution: coexist,
  },
  duration: { kind: "temporary", durationSeconds: FOUR_DAYS },
  merchandisingRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      rankingSnapshotRef: "ranking:collection-x:pre-temp-a",
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: { kind: "money", amountMinor: 0, currency: CAD },
      sourceRef: "merchandising:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId("action_merch_product_a_position_1_temp_4d"),
      expectedPosition: 1,
    },
  },
});

export const rollbackTemporaryProductARank = merchandisingAction({
  actionIdValue: "action_merch_rollback_product_a_temp_rank",
  actionTypeValue: "merchandising.rollback_rank",
  target: product("product:A"),
  description: "Rollback Product A temporary rank only if current rank still matches the temporary output.",
  parameters: {
    kind: "merchandising_rank_rollback",
    originalActionId: temporaryProductAPosition1FourDays.actionId,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      rankingSnapshotRef: "ranking:collection-x:pre-temp-a",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporaryProductAPosition1FourDays.actionId,
      expectedPosition: 1,
    },
  },
  reversalOfActionId: temporaryProductAPosition1FourDays.actionId,
});

export const exclusiveHomepageProductX = feature(
  "merchplace_home_hero_product_x",
  "action_merch_home_hero_product_x",
  product("product:X"),
  homepage("hero"),
  { kind: "NAMED_SLOT", slotId: "hero-1" },
);

export const exclusiveHomepageCollectionY = feature(
  "merchplace_home_hero_collection_y",
  "action_merch_home_hero_collection_y",
  collection("collection:Y"),
  homepage("hero"),
  { kind: "NAMED_SLOT", slotId: "hero-1" },
);

export const beyondHomepageCapacity = feature(
  "merchplace_home_product_z_position_7",
  "action_merch_home_product_z_position_7",
  product("product:Z"),
  homepage(),
  { kind: "POSITION", position: 7 },
);

export const relativeRankMissingSnapshot = merchandisingAction({
  actionIdValue: "action_merch_relative_rank_missing_snapshot",
  actionTypeValue: "merchandising.set_rank",
  target: product("product:F"),
  description: "Move Product F up five positions with a snapshot unavailable at evaluation time.",
  parameters: {
    kind: "merchandising_rank",
    entity: product("product:F"),
    surface: collectionSurface("collection:X"),
    operation: {
      kind: "DELTA",
      direction: "UP",
      positions: 5,
      snapshot: {
        bindingRef: "ranking:missing",
        evaluateAt: "decision_time",
      },
    },
    displacement: "SHIFT_OTHERS",
    conflictResolution: coexist,
  },
});

export const removeProductAHomepagePlacement = merchandisingAction({
  actionIdValue: "action_merch_remove_home_product_a",
  actionTypeValue: "merchandising.remove_placement",
  target: {
    kind: "merchandising_placement",
    placementId: "merchplace_home_product_a",
  },
  description: "Remove Product A from its homepage merchandising placement.",
  parameters: {
    kind: "merchandising_remove_placement",
    placementId: "merchplace_home_product_a",
    surface: homepage(),
  },
});

export const removeSofaACrossSell = merchandisingAction({
  actionIdValue: "action_merch_remove_cross_sofa_a",
  actionTypeValue: "merchandising.remove_relationship",
  target: {
    kind: "merchandising_relationship",
    relationshipId: "merchrel_cross_sofa_a_cushion_b",
  },
  description: "Remove the promoted cross-sell placement without changing underlying complement knowledge.",
  parameters: {
    kind: "merchandising_remove_relationship",
    relationshipId: "merchrel_cross_sofa_a_cushion_b",
    relationshipType: "CROSS_SELL",
  },
});

const ordering = (count: number): readonly MerchandisingEntityTarget[] =>
  Array.from({ length: count }, (_, index) =>
    product("product:" + String(index + 1)),
  );

export const merchandisingRankingSnapshots: readonly MerchandisingRankingSnapshot[] = [
  {
    bindingRef: "ranking:collection-x:d-at-12",
    evaluateAt: "decision_time",
    snapshotTime: DECISION,
    sourceRef: "storefront:collection-x:decision:d-at-12",
    surface: collectionSurface("collection:X"),
    orderedEntities: [
      ...ordering(11),
      product("product:D"),
      product("product:13"),
    ],
  },
  {
    bindingRef: "ranking:collection-x:e-relative",
    evaluateAt: "decision_time",
    snapshotTime: DECISION,
    sourceRef: "storefront:collection-x:decision:e-relative",
    surface: collectionSurface("collection:X"),
    orderedEntities: [
      product("product:1"),
      product("product:2"),
      product("product:3"),
      product("product:4"),
      product("product:5"),
      product("product:6"),
      product("product:7"),
      product("product:E"),
      product("product:9"),
    ],
  },
  {
    bindingRef: "ranking:collection-x:pre-temp-a",
    evaluateAt: "decision_time",
    snapshotTime: DECISION,
    sourceRef: "storefront:collection-x:pre-temp-a",
    surface: collectionSurface("collection:X"),
    orderedEntities: [
      product("product:1"),
      product("product:2"),
      product("product:3"),
      product("product:4"),
      product("product:5"),
      product("product:6"),
      product("product:7"),
      product("product:A"),
      product("product:9"),
    ],
  },
];

export const merchandisingSurfaceDefinitions: readonly MerchandisingSurfaceDefinition[] = [
  {
    surface: homepage(),
    sourceRef: "surface:homepage:featured",
    capacity: 4,
  },
  {
    surface: homepage("hero"),
    sourceRef: "surface:homepage:hero",
    capacity: 1,
    namedSlotIds: ["hero-1"],
  },
  {
    surface: collectionSurface("collection:X"),
    sourceRef: "surface:collection-x",
    capacity: 20,
  },
  {
    surface: {
      kind: "PRODUCT_PAGE",
      productId: "product:A",
    },
    sourceRef: "surface:pdp-product-a",
    capacity: 4,
  },
  {
    surface: {
      kind: "PRODUCT_PAGE",
      productId: "product:sofa-a",
    },
    sourceRef: "surface:pdp-sofa-a",
    capacity: 4,
  },
  {
    surface: {
      kind: "RECOMMENDATION_SLOT",
      slotGroupId: "pdp-related",
    },
    sourceRef: "surface:pdp-related",
    capacity: 3,
  },
];
