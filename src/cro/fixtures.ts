import { currencyCode, utcTimestamp } from "../core/units.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import { actionId, actionType } from "../action_ontology/identity.js";
import type {
  Action,
  CroAddSemantics,
  CroAudience,
  CroCapability,
  CroComponentTarget,
  CroConflictResolution,
  CroDevice,
  CroInterventionKind,
  CroModifiableDimension,
  CroOrderingOperation,
  CroPageScope,
  CroRollbackContract,
  CroSurface,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import type {
  CroExperienceState,
  CroExperienceStateSnapshot,
  CroStructureSnapshot,
} from "./types.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-22T13:00:00Z");
const FRIDAY = utcTimestamp("2026-09-25T04:00:00Z");
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const FOUR_DAYS = 4 * 24 * 60 * 60;

const allVisitors: CroAudience = { kind: "ALL_VISITORS" };
const coexist: CroConflictResolution = { kind: "COEXIST" };

function component(
  name: CroComponentTarget["component"],
  instanceId?: string,
): CroComponentTarget {
  return {
    component: name,
    ...(instanceId ? { instanceId } : {}),
  };
}

function deviceScope(device: CroDevice): Action["scope"] {
  if (device === "ALL_DEVICES") return { dimensions: [] };
  return {
    dimensions: [
      {
        kind: "device",
        devices: [device === "MOBILE" ? "mobile" : "desktop"],
      },
    ],
  };
}

function metricFor(
  surface: CroSurface,
  intervention: CroInterventionKind,
): Action["measurement"] {
  if (intervention === "MODIFY_PERFORMANCE") {
    return {
      earliestMeaningfulEvaluationSeconds: 60 * 60,
      primaryEvaluationSeconds: 3 * 24 * 60 * 60,
      longTermFollowUpSeconds: 7 * 24 * 60 * 60,
      outcomes: [
        {
          family: "experience_performance",
          metricId: "page_performance",
          role: "primary",
        },
        {
          family: "conversion",
          metricId: "conversion_rate",
          role: "guardrail",
        },
      ],
    };
  }
  const metricId =
    surface === "CHECKOUT"
      ? "checkout_completion_rate"
      : surface === "CART"
        ? "cart_to_checkout_rate"
        : surface === "SITE_SEARCH"
          ? "search_engagement_rate"
          : "conversion_rate";
  return {
    earliestMeaningfulEvaluationSeconds: 24 * 60 * 60,
    primaryEvaluationSeconds: 7 * 24 * 60 * 60,
    longTermFollowUpSeconds: 14 * 24 * 60 * 60,
    outcomes: [
      {
        family: surface === "SITE_SEARCH" ? "engagement" : "conversion",
        metricId,
        role: "primary",
      },
    ],
  };
}

function croAction(input: {
  readonly actionIdValue: string;
  readonly experienceId: string;
  readonly actionTypeValue:
    | "cro.modify_experience"
    | "cro.add_element"
    | "cro.remove_element"
    | "cro.reorder_elements"
    | "cro.modify_interaction"
    | "cro.modify_navigation"
    | "cro.modify_search"
    | "cro.modify_checkout"
    | "cro.rollback_experience";
  readonly description: string;
  readonly surface?: CroSurface;
  readonly targetComponent?: CroComponentTarget;
  readonly intervention?: CroInterventionKind;
  readonly pageScope?: CroPageScope;
  readonly device?: CroDevice;
  readonly audience?: CroAudience;
  readonly dimensions?: readonly CroModifiableDimension[];
  readonly ordering?: CroOrderingOperation;
  readonly addSemantics?: CroAddSemantics;
  readonly capabilities?: readonly CroCapability[];
  readonly conflict?: CroConflictResolution;
  readonly duration?: Action["duration"];
  readonly termination?: Action["termination"];
  readonly timing?: Action["timing"];
  readonly croRollback?: CroRollbackContract;
  readonly originalActionId?: Action["reversalOfActionId"];
  readonly rollbackStrategy?: Extract<Action["parameters"], { kind: "cro_rollback" }>["strategy"];
  readonly rollbackGuard?: Extract<Action["parameters"], { kind: "cro_rollback" }>["conflictGuard"];
}): Action {
  const device = input.device ?? "ALL_DEVICES";
  const timing =
    input.timing ??
    ({
      decisionTime: DECISION,
      requestedStart: { kind: "known", at: DECISION },
      effectiveStart: { kind: "known", at: DECISION },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    } as const);
  const duration =
    input.duration ??
    (input.actionTypeValue === "cro.rollback_experience"
      ? ({ kind: "instantaneous" } as const)
      : ({ kind: "persistent" } as const));
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

  const parameters: Action["parameters"] =
    input.actionTypeValue === "cro.rollback_experience"
      ? {
          kind: "cro_rollback",
          originalActionId: input.originalActionId!,
          strategy: input.rollbackStrategy!,
          conflictGuard: input.rollbackGuard!,
        }
      : {
          kind: "cro_intervention",
          surface: input.surface!,
          component: input.targetComponent!,
          intervention: input.intervention!,
          pageScope: input.pageScope!,
          device,
          audience: input.audience ?? allVisitors,
          modifiableDimensions: input.dimensions ?? ["CONTENT_STRUCTURE"],
          ...(input.ordering ? { ordering: input.ordering } : {}),
          ...(input.addSemantics ? { addSemantics: input.addSemantics } : {}),
          requiredCapabilities: input.capabilities ?? [],
          conflictResolution: input.conflict ?? coexist,
        };

  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "cro",
    schemaVersion: "1.7.0",
    description: input.description,
    target: { kind: "cro_experience", experienceId: input.experienceId },
    scope: deviceScope(device),
    parameters,
    timing,
    duration,
    termination,
    resourceRequirements:
      input.intervention === "MODIFY_PERFORMANCE"
        ? [
            {
              resourceType: "engineering_capacity",
              amount: {
                kind: "unknown",
                reason:
                  "implementation effort belongs to a future concrete variant",
              },
            },
          ]
        : [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: { kind: "cro_experience", experienceId: input.experienceId },
        parameterKind: parameters.kind,
      },
      minimumDelaySeconds: 0,
      ...(input.croRollback ? { croRollback: input.croRollback } : {}),
    },
    measurement:
      input.actionTypeValue === "cro.rollback_experience"
        ? {
            earliestMeaningfulEvaluationSeconds: 0,
            primaryEvaluationSeconds: 24 * 60 * 60,
            outcomes: [
              {
                family: "conversion",
                metricId: "conversion_rate",
                role: "primary",
              },
            ],
          }
        : metricFor(input.surface!, input.intervention!),
    intent: {
      statement:
        "Represent a structured CRO business intervention without embedding a concrete variant.",
    },
    ...(input.originalActionId
      ? { reversalOfActionId: input.originalActionId }
      : {}),
  });
}

export const modifyHomepageHeroPresentation = croAction({
  actionIdValue: "action_cro_home_hero_presentation",
  experienceId: "croexp_home_hero",
  actionTypeValue: "cro.modify_experience",
  description: "Modify homepage hero presentation.",
  surface: "HOMEPAGE",
  targetComponent: component("HERO"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["PROMINENCE", "VISUAL_HIERARCHY", "LAYOUT"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const addFeaturedCollectionHomepage = croAction({
  actionIdValue: "action_cro_home_add_featured_collection",
  experienceId: "croexp_home_featured_collection_add",
  actionTypeValue: "cro.add_element",
  description: "Add a featured-collection component to the homepage.",
  surface: "HOMEPAGE",
  targetComponent: component("FEATURED_COLLECTIONS", "seasonal"),
  intervention: "ADD",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["CONTENT_STRUCTURE", "POSITION"],
  addSemantics: {
    kind: "ALLOW_ADDITIONAL_INSTANCE",
    instanceId: "seasonal",
  },
  capabilities: ["ADD_COMPONENT"],
});

export const modifyCollectionProductCardPresentation = croAction({
  actionIdValue: "action_cro_collection_product_card_presentation",
  experienceId: "croexp_collection_product_card",
  actionTypeValue: "cro.modify_experience",
  description: "Modify collection product-card presentation.",
  surface: "COLLECTION",
  targetComponent: component("PRODUCT_CARD"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_COLLECTIONS" },
  dimensions: ["LAYOUT", "VISUAL_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyCollectionFilters = croAction({
  actionIdValue: "action_cro_collection_filters",
  experienceId: "croexp_collection_filters",
  actionTypeValue: "cro.modify_experience",
  description: "Modify collection filters.",
  surface: "COLLECTION",
  targetComponent: component("FILTERS"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_COLLECTIONS" },
  dimensions: ["FILTER_CONFIGURATION", "INTERACTION"],
  capabilities: ["MODIFY_PRESENTATION", "FILTERS"],
});

export const modifyMobileCollectionGridDensity = croAction({
  actionIdValue: "action_cro_collection_grid_density_mobile",
  experienceId: "croexp_collection_grid_mobile",
  actionTypeValue: "cro.modify_experience",
  description: "Change collection-grid density on mobile.",
  surface: "COLLECTION",
  targetComponent: component("PRODUCT_GRID"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_COLLECTIONS" },
  device: "MOBILE",
  dimensions: ["DENSITY", "LAYOUT"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyDesktopCollectionGridDensity = croAction({
  actionIdValue: "action_cro_collection_grid_density_desktop",
  experienceId: "croexp_collection_grid_desktop",
  actionTypeValue: "cro.modify_experience",
  description: "Change collection-grid density on desktop.",
  surface: "COLLECTION",
  targetComponent: component("PRODUCT_GRID"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_COLLECTIONS" },
  device: "DESKTOP",
  dimensions: ["DENSITY", "LAYOUT"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyPdpGalleryInteraction = croAction({
  actionIdValue: "action_cro_pdp_gallery_interaction",
  experienceId: "croexp_pdp_gallery",
  actionTypeValue: "cro.modify_interaction",
  description: "Modify PDP product-gallery interaction.",
  surface: "PDP",
  targetComponent: component("PRODUCT_GALLERY"),
  intervention: "MODIFY_INTERACTION",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["INTERACTION", "IMAGE_LOADING"],
  capabilities: ["MODIFY_INTERACTION"],
});

export const increaseAddToCartProminence = croAction({
  actionIdValue: "action_cro_pdp_atc_prominence",
  experienceId: "croexp_pdp_atc",
  actionTypeValue: "cro.modify_experience",
  description: "Increase Add to Cart prominence on PDP.",
  surface: "PDP",
  targetComponent: component("ADD_TO_CART"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["PROMINENCE", "VISUAL_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const movePdpDeliveryAboveDescription = croAction({
  actionIdValue: "action_cro_pdp_delivery_before_description",
  experienceId: "croexp_pdp_delivery_order",
  actionTypeValue: "cro.reorder_elements",
  description: "Move PDP delivery information above product description.",
  surface: "PDP",
  targetComponent: component("DELIVERY_INFORMATION"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: {
    kind: "PLACE_BEFORE",
    referenceComponent: component("PRODUCT_DESCRIPTION"),
    snapshot: {
      bindingRef: "cro-structure:pdp-default",
      evaluateAt: "decision_time",
    },
  },
  capabilities: ["REORDER_COMPONENTS"],
});

export const addReturnsInformationNearAtc = croAction({
  actionIdValue: "action_cro_pdp_add_returns_information",
  experienceId: "croexp_pdp_returns_add",
  actionTypeValue: "cro.add_element",
  description: "Add returns information near Add to Cart.",
  surface: "PDP",
  targetComponent: component("RETURNS_INFORMATION"),
  intervention: "ADD",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:pdp-no-returns" },
  dimensions: ["CONTENT_STRUCTURE", "POSITION"],
  addSemantics: { kind: "REQUIRE_ABSENT" },
  capabilities: ["ADD_COMPONENT"],
});

export const modifyCartLayout = croAction({
  actionIdValue: "action_cro_cart_layout",
  experienceId: "croexp_cart_layout",
  actionTypeValue: "cro.modify_experience",
  description: "Modify cart layout.",
  surface: "CART",
  targetComponent: component("PAGE_LAYOUT"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["LAYOUT", "INFORMATION_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyCartCheckoutCtaPresentation = croAction({
  actionIdValue: "action_cro_cart_checkout_cta_presentation",
  experienceId: "croexp_cart_checkout_cta",
  actionTypeValue: "cro.modify_experience",
  description: "Modify cart checkout CTA presentation.",
  surface: "CART",
  targetComponent: component("CHECKOUT_CTA"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["PROMINENCE", "VISUAL_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const addFreeShippingThresholdMessageCart = croAction({
  actionIdValue: "action_cro_cart_add_shipping_threshold_message",
  experienceId: "croexp_cart_shipping_message",
  actionTypeValue: "cro.add_element",
  description:
    "Add free-shipping threshold messaging to cart without changing shipping policy.",
  surface: "CART",
  targetComponent: component("SHIPPING_MESSAGE"),
  intervention: "ADD",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:cart-no-shipping-message" },
  dimensions: ["SHIPPING_MESSAGE_PRESENTATION", "CONTENT_STRUCTURE"],
  addSemantics: { kind: "REQUIRE_ABSENT" },
  capabilities: ["ADD_COMPONENT"],
});

export const modifyCartPromotionEntryPresentation = croAction({
  actionIdValue: "action_cro_cart_promotion_entry_presentation",
  experienceId: "croexp_cart_promotion_entry",
  actionTypeValue: "cro.modify_experience",
  description:
    "Modify coupon entry visibility/error presentation without changing promotion eligibility or depth.",
  surface: "CART",
  targetComponent: component("PROMOTION_ENTRY"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["PROMOTION_MESSAGE_PRESENTATION", "ERROR_PRESENTATION"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyCheckoutFormStructure = croAction({
  actionIdValue: "action_cro_checkout_form_structure",
  experienceId: "croexp_checkout_form",
  actionTypeValue: "cro.modify_checkout",
  description: "Modify checkout form structure.",
  surface: "CHECKOUT",
  targetComponent: component("FORM"),
  intervention: "MODIFY_CHECKOUT",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout" },
  dimensions: ["REQUIRED_FIELDS", "STEP_STRUCTURE", "INFORMATION_HIERARCHY"],
  capabilities: ["MODIFY_CHECKOUT_EXPERIENCE"],
});

export const removeOptionalCheckoutField = croAction({
  actionIdValue: "action_cro_checkout_remove_optional_field",
  experienceId: "croexp_checkout_field_company",
  actionTypeValue: "cro.remove_element",
  description: "Remove an optional checkout field.",
  surface: "CHECKOUT",
  targetComponent: component("FIELD", "company_optional"),
  intervention: "REMOVE",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout" },
  dimensions: ["CONTENT_STRUCTURE", "REQUIRED_FIELDS"],
  capabilities: ["REMOVE_COMPONENT"],
});

export const addCheckoutProgressIndicator = croAction({
  actionIdValue: "action_cro_checkout_add_progress",
  experienceId: "croexp_checkout_progress",
  actionTypeValue: "cro.add_element",
  description: "Add checkout progress indicator.",
  surface: "CHECKOUT",
  targetComponent: component("PROGRESS_INDICATOR"),
  intervention: "ADD",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout-no-progress" },
  dimensions: ["PROGRESS_COMMUNICATION", "CONTENT_STRUCTURE"],
  addSemantics: { kind: "REQUIRE_ABSENT" },
  capabilities: ["ADD_COMPONENT"],
});

export const modifyCheckoutErrorPresentation = croAction({
  actionIdValue: "action_cro_checkout_error_presentation",
  experienceId: "croexp_checkout_errors",
  actionTypeValue: "cro.modify_checkout",
  description: "Modify checkout error presentation.",
  surface: "CHECKOUT",
  targetComponent: component("ERROR_HANDLING"),
  intervention: "MODIFY_CHECKOUT",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout" },
  dimensions: ["ERROR_PRESENTATION"],
  capabilities: ["MODIFY_CHECKOUT_EXPERIENCE"],
});

export const addSiteSearchAutocomplete = croAction({
  actionIdValue: "action_cro_search_add_autocomplete",
  experienceId: "croexp_search_autocomplete",
  actionTypeValue: "cro.add_element",
  description: "Add autocomplete to site search.",
  surface: "SITE_SEARCH",
  targetComponent: component("AUTOCOMPLETE"),
  intervention: "ADD",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["AUTOCOMPLETE", "INTERACTION"],
  addSemantics: { kind: "REQUIRE_ABSENT" },
  capabilities: ["ADD_COMPONENT", "AUTOCOMPLETE"],
});

export const modifySearchNoResults = croAction({
  actionIdValue: "action_cro_search_no_results",
  experienceId: "croexp_search_no_results",
  actionTypeValue: "cro.modify_search",
  description: "Modify search no-results experience.",
  surface: "SITE_SEARCH",
  targetComponent: component("NO_RESULTS_STATE"),
  intervention: "MODIFY_SEARCH",
  pageScope: { kind: "ALL_SURFACE" },
  dimensions: ["NO_RESULTS_HANDLING", "CONTENT_STRUCTURE"],
  capabilities: ["MODIFY_SEARCH_EXPERIENCE", "NO_RESULTS_EXPERIENCE"],
});

export const modifyLandingPageCta = croAction({
  actionIdValue: "action_cro_landing_cta",
  experienceId: "croexp_landing_cta",
  actionTypeValue: "cro.modify_experience",
  description: "Modify landing-page CTA presentation.",
  surface: "LANDING_PAGE",
  targetComponent: component("CTA"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "LANDING_PAGE", landingPageId: "landing:fall" },
  dimensions: ["PROMINENCE", "VISUAL_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyLandingPageCtaNewVisitors = croAction({
  actionIdValue: "action_cro_landing_cta_new_visitors",
  experienceId: "croexp_landing_cta_new",
  actionTypeValue: "cro.modify_experience",
  description: "Modify landing-page CTA for new visitors.",
  surface: "LANDING_PAGE",
  targetComponent: component("CTA"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "LANDING_PAGE", landingPageId: "landing:fall" },
  audience: { kind: "NEW_VISITORS" },
  dimensions: ["PROMINENCE"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyLandingPageCtaVipSegment = croAction({
  actionIdValue: "action_cro_landing_cta_vip_segment",
  experienceId: "croexp_landing_cta_vip",
  actionTypeValue: "cro.modify_experience",
  description: "Modify landing-page CTA for canonical VIP segment.",
  surface: "LANDING_PAGE",
  targetComponent: component("CTA"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "LANDING_PAGE", landingPageId: "landing:fall" },
  audience: {
    kind: "CUSTOMER_SEGMENT",
    segmentId: "vip:A",
    membership: {
      evaluateAt: "decision_time",
      bindingRef: "cro-audience:vip-a:decision",
    },
  },
  dimensions: ["PROMINENCE"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const removeLandingPageNavigation = croAction({
  actionIdValue: "action_cro_landing_remove_navigation",
  experienceId: "croexp_landing_navigation",
  actionTypeValue: "cro.remove_element",
  description: "Remove landing-page navigation.",
  surface: "LANDING_PAGE",
  targetComponent: component("NAVIGATION"),
  intervention: "REMOVE",
  pageScope: { kind: "LANDING_PAGE", landingPageId: "landing:fall" },
  dimensions: ["CONTENT_STRUCTURE"],
  capabilities: ["REMOVE_COMPONENT"],
});

export const modifyMobileNavigation = croAction({
  actionIdValue: "action_cro_mobile_navigation",
  experienceId: "croexp_site_navigation_mobile",
  actionTypeValue: "cro.modify_navigation",
  description: "Modify mobile primary navigation interaction.",
  surface: "SITE_WIDE",
  targetComponent: component("NAVIGATION"),
  intervention: "MODIFY_NAVIGATION",
  pageScope: { kind: "ALL_SURFACE" },
  device: "MOBILE",
  dimensions: ["NAVIGATION_STRUCTURE", "INTERACTION"],
  capabilities: ["MODIFY_NAVIGATION"],
});

export const modifyDesktopHomepageHero = croAction({
  actionIdValue: "action_cro_home_hero_desktop",
  experienceId: "croexp_home_hero_desktop",
  actionTypeValue: "cro.modify_experience",
  description: "Modify homepage hero on desktop.",
  surface: "HOMEPAGE",
  targetComponent: component("HERO"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_SURFACE" },
  device: "DESKTOP",
  dimensions: ["LAYOUT", "PROMINENCE"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const improveMobilePdpLoadingPerformance = croAction({
  actionIdValue: "action_cro_pdp_mobile_performance",
  experienceId: "croexp_pdp_mobile_performance",
  actionTypeValue: "cro.modify_experience",
  description: "Improve PDP loading performance on mobile.",
  surface: "PDP",
  targetComponent: component("PAGE_LAYOUT"),
  intervention: "MODIFY_PERFORMANCE",
  pageScope: { kind: "ALL_PDP" },
  device: "MOBILE",
  dimensions: ["LOAD_PERFORMANCE", "INTERACTION_LATENCY", "IMAGE_LOADING"],
  capabilities: ["MODIFY_PERFORMANCE"],
});

export const modifyPdpPriceDisplayPresentation = croAction({
  actionIdValue: "action_cro_pdp_price_display_presentation",
  experienceId: "croexp_pdp_price_display",
  actionTypeValue: "cro.modify_experience",
  description: "Modify PDP price-display presentation without changing product price.",
  surface: "PDP",
  targetComponent: component("PRICE_DISPLAY"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["PROMINENCE", "VISUAL_HIERARCHY"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const setPdpReviewsPosition2 = croAction({
  actionIdValue: "action_cro_pdp_reviews_position_2",
  experienceId: "croexp_pdp_reviews_position_2",
  actionTypeValue: "cro.reorder_elements",
  description: "Set PDP reviews component to position 2.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: { kind: "SET_POSITION", position: 2 },
  capabilities: ["REORDER_COMPONENTS"],
});

export const modifyPdpDeliveryPresentation = croAction({
  actionIdValue: "action_cro_pdp_delivery_presentation",
  experienceId: "croexp_pdp_delivery_presentation",
  actionTypeValue: "cro.modify_experience",
  description: "Modify PDP delivery-information presentation.",
  surface: "PDP",
  targetComponent: component("DELIVERY_INFORMATION"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION", "PROMINENCE", "CONTENT_STRUCTURE"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const modifyProductAPdpDeliveryPresentation = croAction({
  actionIdValue: "action_cro_product_a_pdp_delivery",
  experienceId: "croexp_product_a_pdp_delivery",
  actionTypeValue: "cro.modify_experience",
  description: "Modify delivery-information presentation only on Product A PDP.",
  surface: "PDP",
  targetComponent: component("DELIVERY_INFORMATION"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "PRODUCT_PDP", productId: "product:A" },
  dimensions: ["PROMINENCE", "CONTENT_STRUCTURE"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const temporaryPdpDeliveryReorder = croAction({
  actionIdValue: "action_cro_pdp_delivery_temp_reorder",
  experienceId: "croexp_pdp_delivery_temp",
  actionTypeValue: "cro.reorder_elements",
  description: "For seven days, move PDP delivery information above product description.",
  surface: "PDP",
  targetComponent: component("DELIVERY_INFORMATION"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: {
    kind: "PLACE_BEFORE",
    referenceComponent: component("PRODUCT_DESCRIPTION"),
    snapshot: {
      bindingRef: "cro-structure:pdp-default",
      evaluateAt: "decision_time",
    },
  },
  capabilities: ["REORDER_COMPONENTS"],
  duration: { kind: "temporary", durationSeconds: SEVEN_DAYS },
  croRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      stateSnapshotRef: "cro-state-snapshot:pdp-delivery-pre-temp",
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: { kind: "money", amountMinor: 0, currency: CAD },
      sourceRef: "cro:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId("action_cro_pdp_delivery_temp_reorder"),
      expectedStateRef: "cro-state:pdp-delivery-position-7",
    },
  },
});

export const rollbackTemporaryPdpDeliveryReorder = croAction({
  actionIdValue: "action_cro_rollback_pdp_delivery_temp",
  experienceId: "croexp_pdp_delivery_temp",
  actionTypeValue: "cro.rollback_experience",
  description: "Rollback temporary PDP delivery ordering if its output still owns current state.",
  originalActionId: temporaryPdpDeliveryReorder.actionId,
  rollbackStrategy: {
    kind: "RESTORE_PRE_ACTION_VALUE",
    stateSnapshotRef: "cro-state-snapshot:pdp-delivery-pre-temp",
  },
  rollbackGuard: {
    kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
    sourceActionId: temporaryPdpDeliveryReorder.actionId,
    expectedStateRef: "cro-state:pdp-delivery-position-7",
  },
});

export const removeReviewsMissingComponent = croAction({
  actionIdValue: "action_cro_pdp_remove_reviews_missing",
  experienceId: "croexp_pdp_reviews_missing",
  actionTypeValue: "cro.remove_element",
  description: "Remove reviews from a PDP template where current-state context lacks reviews.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "REMOVE",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:pdp-no-reviews" },
  dimensions: ["CONTENT_STRUCTURE"],
  capabilities: ["REMOVE_COMPONENT"],
});

export const reorderWithUnavailableStructure = croAction({
  actionIdValue: "action_cro_pdp_reorder_missing_structure",
  experienceId: "croexp_pdp_missing_structure",
  actionTypeValue: "cro.reorder_elements",
  description: "Move reviews above description using a structure binding unavailable at evaluation time.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: {
    kind: "PLACE_BEFORE",
    referenceComponent: component("PRODUCT_DESCRIPTION"),
    snapshot: {
      bindingRef: "cro-structure:missing",
      evaluateAt: "decision_time",
    },
  },
  capabilities: ["REORDER_COMPONENTS"],
});

export const placeReviewsAfterAtc = croAction({
  actionIdValue: "action_cro_pdp_reviews_after_atc",
  experienceId: "croexp_pdp_reviews_after_atc",
  actionTypeValue: "cro.reorder_elements",
  description: "Place reviews directly after Add to Cart.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: {
    kind: "PLACE_AFTER",
    referenceComponent: component("ADD_TO_CART"),
    snapshot: {
      bindingRef: "cro-structure:pdp-default",
      evaluateAt: "decision_time",
    },
  },
  capabilities: ["REORDER_COMPONENTS"],
});

export const placeDeliveryAfterAtc = croAction({
  actionIdValue: "action_cro_pdp_delivery_after_atc",
  experienceId: "croexp_pdp_delivery_after_atc",
  actionTypeValue: "cro.reorder_elements",
  description: "Place delivery information directly after Add to Cart.",
  surface: "PDP",
  targetComponent: component("DELIVERY_INFORMATION"),
  intervention: "REORDER",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["POSITION"],
  ordering: {
    kind: "PLACE_AFTER",
    referenceComponent: component("ADD_TO_CART"),
    snapshot: {
      bindingRef: "cro-structure:pdp-default",
      evaluateAt: "decision_time",
    },
  },
  capabilities: ["REORDER_COMPONENTS"],
});

export const addReviewsToPdp = croAction({
  actionIdValue: "action_cro_pdp_add_reviews",
  experienceId: "croexp_pdp_reviews",
  actionTypeValue: "cro.add_element",
  description: "Add reviews to PDP.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "ADD",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:pdp-no-reviews" },
  dimensions: ["CONTENT_STRUCTURE"],
  addSemantics: { kind: "REQUIRE_ABSENT" },
  capabilities: ["ADD_COMPONENT"],
});

export const modifyReviewsOnPdp = croAction({
  actionIdValue: "action_cro_pdp_modify_reviews",
  experienceId: "croexp_pdp_reviews",
  actionTypeValue: "cro.modify_experience",
  description: "Modify reviews presentation on PDP.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "MODIFY_PRESENTATION",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["PROMINENCE", "LAYOUT"],
  capabilities: ["MODIFY_PRESENTATION"],
});

export const removeReviewsFromPdp = croAction({
  actionIdValue: "action_cro_pdp_remove_reviews",
  experienceId: "croexp_pdp_reviews",
  actionTypeValue: "cro.remove_element",
  description: "Remove reviews from PDP.",
  surface: "PDP",
  targetComponent: component("REVIEWS"),
  intervention: "REMOVE",
  pageScope: { kind: "ALL_PDP" },
  dimensions: ["CONTENT_STRUCTURE"],
  capabilities: ["REMOVE_COMPONENT"],
});

export const temporaryCheckoutWeekendForm = croAction({
  actionIdValue: "action_cro_checkout_weekend_form",
  experienceId: "croexp_checkout_weekend_form",
  actionTypeValue: "cro.modify_checkout",
  description: "Use simplified checkout form structure from Friday through Monday.",
  surface: "CHECKOUT",
  targetComponent: component("FORM"),
  intervention: "MODIFY_CHECKOUT",
  pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout" },
  dimensions: ["REQUIRED_FIELDS", "STEP_STRUCTURE"],
  capabilities: ["MODIFY_CHECKOUT_EXPERIENCE"],
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: FRIDAY },
    effectiveStart: { kind: "known", at: FRIDAY },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
  duration: { kind: "temporary", durationSeconds: FOUR_DAYS },
  croRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      stateSnapshotRef: "cro-state-snapshot:checkout-form-pre-weekend",
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "unknown",
      reason: "implementation rollback cost is not known at Action definition time",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId("action_cro_checkout_weekend_form"),
      expectedStateRef: "cro-state:checkout-form-weekend",
    },
  },
});

export const invalidVagueImprovePdpClarity: unknown = {
  ...modifyPdpDeliveryPresentation,
  actionId: "action_cro_invalid_vague_clarity",
  description: "Improve PDP clarity.",
  parameters: {
    ...modifyPdpDeliveryPresentation.parameters,
    modifiableDimensions: [],
  },
};

const pdpDefaultOrder: readonly CroComponentTarget[] = [
  component("PAGE_LAYOUT"),
  component("PRODUCT_GALLERY"),
  component("PRODUCT_TITLE"),
  component("PRICE_DISPLAY"),
  component("VARIANT_SELECTOR"),
  component("ADD_TO_CART"),
  component("PRODUCT_DESCRIPTION"),
  component("DELIVERY_INFORMATION"),
  component("REVIEWS"),
  component("STOCK_INFORMATION"),
  component("PAYMENT_INFORMATION"),
];

export const croStructureSnapshots: readonly CroStructureSnapshot[] = [
  {
    bindingRef: "cro-structure:pdp-default",
    evaluateAt: "decision_time",
    snapshotTime: DECISION,
    sourceRef: "storefront:pdp-default:decision",
    surface: "PDP",
    pageScope: { kind: "ALL_PDP" },
    device: "ALL_DEVICES",
    orderedComponents: pdpDefaultOrder,
  },
];

export const croExperienceStates: readonly CroExperienceState[] = [
  {
    surface: "HOMEPAGE",
    pageScope: { kind: "ALL_SURFACE" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:homepage:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("HERO"),
      component("FEATURED_PRODUCTS"),
      component("NAVIGATION"),
      component("SOCIAL_PROOF"),
    ],
    capabilities: [
      "ADD_COMPONENT",
      "REMOVE_COMPONENT",
      "REORDER_COMPONENTS",
      "MODIFY_PRESENTATION",
    ],
  },
  {
    surface: "COLLECTION",
    pageScope: { kind: "ALL_COLLECTIONS" },
    device: "MOBILE",
    sourceRef: "storefront:collection-mobile:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("PRODUCT_GRID"),
      component("PRODUCT_CARD"),
      component("FILTERS"),
      component("SORTING"),
    ],
    capabilities: [
      "MODIFY_PRESENTATION",
      "MODIFY_INTERACTION",
      "FILTERS",
      "SORTING",
      "REORDER_COMPONENTS",
    ],
  },
  {
    surface: "COLLECTION",
    pageScope: { kind: "ALL_COLLECTIONS" },
    device: "DESKTOP",
    sourceRef: "storefront:collection-desktop:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("PRODUCT_GRID"),
      component("PRODUCT_CARD"),
      component("FILTERS"),
      component("SORTING"),
    ],
    capabilities: [
      "MODIFY_PRESENTATION",
      "FILTERS",
      "SORTING",
      "REORDER_COMPONENTS",
    ],
  },
  {
    surface: "PDP",
    pageScope: { kind: "ALL_PDP" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:pdp-default:decision",
    presentComponents: pdpDefaultOrder,
    capabilities: [
      "ADD_COMPONENT",
      "REMOVE_COMPONENT",
      "REORDER_COMPONENTS",
      "MODIFY_PRESENTATION",
      "MODIFY_INTERACTION",
    ],
    componentStates: [
      {
        component: component("DELIVERY_INFORMATION"),
        stateRef: "cro-state:pdp-delivery-position-8",
      },
    ],
  },
  {
    surface: "PDP",
    pageScope: { kind: "ALL_PDP" },
    device: "MOBILE",
    sourceRef: "storefront:pdp-mobile:decision",
    presentComponents: pdpDefaultOrder,
    capabilities: [
      "MODIFY_PRESENTATION",
      "MODIFY_INTERACTION",
      "MODIFY_PERFORMANCE",
      "REORDER_COMPONENTS",
    ],
    performanceConfigurationRef: "performance:pdp-mobile:current",
  },
  {
    surface: "PDP",
    pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:pdp-no-reviews" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:pdp-no-reviews:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("PRODUCT_GALLERY"),
      component("PRODUCT_TITLE"),
      component("ADD_TO_CART"),
      component("PRODUCT_DESCRIPTION"),
    ],
    capabilities: ["ADD_COMPONENT", "REMOVE_COMPONENT", "MODIFY_PRESENTATION"],
  },
  {
    surface: "PDP",
    pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:pdp-no-returns" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:pdp-no-returns:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("PRODUCT_GALLERY"),
      component("ADD_TO_CART"),
      component("PRODUCT_DESCRIPTION"),
      component("DELIVERY_INFORMATION"),
    ],
    capabilities: ["ADD_COMPONENT", "MODIFY_PRESENTATION"],
  },
  {
    surface: "CART",
    pageScope: { kind: "ALL_SURFACE" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:cart:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("CART_ITEMS"),
      component("ORDER_SUMMARY"),
      component("PROMOTION_ENTRY"),
      component("CHECKOUT_CTA"),
    ],
    capabilities: ["ADD_COMPONENT", "REMOVE_COMPONENT", "MODIFY_PRESENTATION"],
  },
  {
    surface: "CART",
    pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:cart-no-shipping-message" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:cart-no-shipping-message:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("CART_ITEMS"),
      component("ORDER_SUMMARY"),
      component("CHECKOUT_CTA"),
    ],
    capabilities: ["ADD_COMPONENT", "MODIFY_PRESENTATION"],
  },
  {
    surface: "CHECKOUT",
    pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:checkout:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("FORM"),
      component("FIELD", "company_optional"),
      component("ERROR_HANDLING"),
      component("EXPRESS_PAYMENT"),
      component("ORDER_SUMMARY"),
    ],
    capabilities: [
      "ADD_COMPONENT",
      "REMOVE_COMPONENT",
      "REORDER_COMPONENTS",
      "MODIFY_CHECKOUT_EXPERIENCE",
    ],
  },
  {
    surface: "CHECKOUT",
    pageScope: { kind: "PAGE_TEMPLATE", templateId: "template:checkout-no-progress" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:checkout-no-progress:decision",
    presentComponents: [component("FORM"), component("ORDER_SUMMARY")],
    capabilities: ["ADD_COMPONENT", "MODIFY_CHECKOUT_EXPERIENCE"],
  },
  {
    surface: "SITE_SEARCH",
    pageScope: { kind: "ALL_SURFACE" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:search:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("SEARCH_INPUT"),
      component("SEARCH_RESULTS"),
      component("FILTERS"),
      component("SORTING"),
      component("NO_RESULTS_STATE"),
    ],
    capabilities: [
      "ADD_COMPONENT",
      "MODIFY_SEARCH_EXPERIENCE",
      "AUTOCOMPLETE",
      "FILTERS",
      "SORTING",
      "NO_RESULTS_EXPERIENCE",
    ],
  },
  {
    surface: "LANDING_PAGE",
    pageScope: { kind: "LANDING_PAGE", landingPageId: "landing:fall" },
    device: "ALL_DEVICES",
    sourceRef: "storefront:landing-fall:decision",
    presentComponents: [
      component("PAGE_LAYOUT"),
      component("HERO"),
      component("CTA"),
      component("CONTENT_SECTION"),
      component("SOCIAL_PROOF"),
      component("NAVIGATION"),
    ],
    capabilities: ["REMOVE_COMPONENT", "MODIFY_PRESENTATION", "REORDER_COMPONENTS"],
  },
  {
    surface: "SITE_WIDE",
    pageScope: { kind: "ALL_SURFACE" },
    device: "MOBILE",
    sourceRef: "storefront:site-nav-mobile:decision",
    presentComponents: [component("NAVIGATION")],
    capabilities: ["MODIFY_NAVIGATION"],
  },
];

export const croStateSnapshots: readonly CroExperienceStateSnapshot[] = [
  {
    stateSnapshotRef: "cro-state-snapshot:pdp-delivery-pre-temp",
    stateRef: "cro-state:pdp-delivery-position-8",
    sourceRef: "storefront:pdp-delivery:pre-temp",
  },
  {
    stateSnapshotRef: "cro-state-snapshot:checkout-form-pre-weekend",
    stateRef: "cro-state:checkout-form-default",
    sourceRef: "storefront:checkout-form:pre-weekend",
  },
];
