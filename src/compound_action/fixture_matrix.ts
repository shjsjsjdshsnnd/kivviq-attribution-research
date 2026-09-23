import { actionId,constraintId } from "../action_ontology/identity.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { doNothingAction,investigateTrackingAnomaly,waitObserveAction } from "../action_ontology/fixtures.js";
import type { Action } from "../action_ontology/types.js";
import { fridaySevenDayBudgetTiming,inventoryFirstOfTerminationTiming } from "../action_timing/fixtures.js";
import type { ActionTiming } from "../action_timing/types.js";
import {
  increaseGoogleShoppingBudget20,
  increaseMeta500PerDay,
  decreaseMetaProspectingBudget500PerDay,
  increaseProductWithContributionMarginFloor,
  pauseLowInventorySkuB,
} from "../paid_media/fixtures.js";
import {
  startAutomaticCollectionX15FourDays,
  startVipSegmentA20,
} from "../promotion/fixtures.js";
import { sendEmailSegmentAFriday10 } from "../lifecycle/fixtures.js";
import {
  featureCollectionXHomepageSlot1,
  deprioritizeProductBCollectionY,
  setProductCPosition1CollectionX,
} from "../merchandising/fixtures.js";
import {
  protectSkuAAt20,
  accelerateSkuAExcessUntil50,
} from "../inventory/fixtures.js";
import {
  reduceSkuA10Percent,
  temporarySkuA799SevenDays,
} from "../pricing/fixtures.js";
import { temporarySitewideFreeFridayMonday } from "../shipping/fixtures.js";
import {
  COMPOUND_ACTION_SCHEMA_VERSION,
  type CompoundAction,
  type CompoundActionComponent,
  type CompoundActionId,
  type ComponentDependency,
} from "./types.js";
import { validateCompoundAction } from "./validation.js";

const compoundId=(v:string)=>v as CompoundActionId;
const NA={kind:"NOT_APPLICABLE",reason:"This component does not use a first-party customer population."} as const;
const commonMeasurement={earliestMeaningfulEvaluationSeconds:86400,primaryEvaluationSeconds:30*86400,longTermFollowUpSeconds:60*86400,metricIds:["revenue","orders","contribution_profit"]} as const;
const commonProvenance={source:"human",createdAt:"2026-09-23T12:00:00.000Z",evidenceRefs:[]} as const;

function component(componentId:string,action:Action,opts:Partial<CompoundActionComponent>={}):CompoundActionComponent{
  return{
    componentId,
    action,
    population:NA,
    timing:{kind:"INHERIT"},
    ...opts,
  };
}
function compound(
  id:string,
  description:string,
  components:readonly CompoundActionComponent[],
  opts:Partial<Omit<CompoundAction,"kind"|"compoundActionId"|"schemaVersion"|"description"|"components"|"measurement"|"provenance">>={},
):CompoundAction{
  const value:CompoundAction={
    kind:"compound_action",
    compoundActionId:compoundId(id),
    schemaVersion:COMPOUND_ACTION_SCHEMA_VERSION,
    description,
    intent:description,
    components,
    ordering:{kind:"UNORDERED"},
    concurrency:"INDEPENDENT_TIMING",
    dependencies:[],
    atomicity:"BEST_EFFORT",
    failurePolicy:"CONTINUE_INDEPENDENT_COMPONENTS",
    completionRule:"ALL_COMPONENTS_COMPLETE",
    timing:fridaySevenDayBudgetTiming,
    constraints:[],
    rollback:{policy:"ROLLBACK_ALL_REVERSIBLE_COMPONENTS",order:"REVERSE_DEPENDENCY_ORDER",irreversibleComponentPolicy:"REPORT_AND_CONTINUE"},
    measurement:commonMeasurement,
    provenance:commonProvenance,
    ...opts,
  };
  return value;
}

const skuA={kind:"sku" as const,productId:"product:A",skuId:"sku:A"};

export const pauseSkuAAdvertising=assertValidAction({
  ...pauseLowInventorySkuB,
  actionId:actionId("action_paid_media_pause_sku_a"),
  description:"Pause paid advertising for SKU A when protected inventory is low.",
  target:skuA,
  constraints:[{
    constraintId:constraintId("sku_a_inventory_at_or_below_20"),
    constraintClass:"hard",
    expression:{kind:"property_comparison",propertyId:"inventory.available_to_sell_units",operator:"LTE",value:{kind:"quantity",value:20,unit:"units"}},
  }],
});

export const deprioritizeSkuAOnsite=assertValidAction({
  ...deprioritizeProductBCollectionY,
  actionId:actionId("action_merchandising_deprioritize_sku_a"),
  description:"Deprioritize SKU A onsite while inventory protection is active.",
  target:skuA,
  parameters:{
    ...deprioritizeProductBCollectionY.parameters,
    entity:skuA,
  } as any,
});

export const reduceSkuA20Percent=assertValidAction({
  ...reduceSkuA10Percent,
  actionId:actionId("action_price_sku_a_reduce_20pct"),
  description:"Reduce SKU A price by 20% for clearance.",
  parameters:{
    ...reduceSkuA10Percent.parameters,
    operation:{
      ...(reduceSkuA10Percent.parameters as any).operation,
      kind:"MULTIPLY",
      factor:0.8,
    },
  } as any,
});

export const featureSkuAInClearance=assertValidAction({
  ...setProductCPosition1CollectionX,
  actionId:actionId("action_merch_feature_sku_a_clearance"),
  description:"Feature SKU A at position 1 in the clearance collection.",
  target:skuA,
  parameters:{
    ...(setProductCPosition1CollectionX.parameters as any),
    entity:skuA,
    surface:{kind:"COLLECTION_PAGE",collectionId:"collection:clearance"},
  },
});

export const googleBudgetPlus500PerDay=assertValidAction({
  ...increaseMeta500PerDay,
  actionId:actionId("action_pm_google_plus_500_day_compound_fixture"),
  description:"Increase Google budget by CAD 500/day.",
  target:{kind:"advertising_channel",channelId:"google_ads"},
});

const recurringWeekendTiming:ActionTiming={
  ...fridaySevenDayBudgetTiming,
  duration:{state:"SPECIFIED",value:{kind:"ELAPSED",amount:48,unit:"HOUR",anchor:"EFFECTIVE_START"}},
  end:{state:"ABSENT",reason:"Each recurrence occurrence has its own 48-hour active window."},
  recurrence:{state:"SPECIFIED",value:{frequency:{kind:"WEEKLY",interval:1,daysOfWeek:[5,6,0],localTime:"00:00"},boundary:{kind:"BOUNDED",maxOccurrences:4}}},
};

export const fixture01BudgetReallocation=compound(
  "compound_fixture_01_budget_reallocation",
  "Move CAD 2,000/week from Meta to Google.",
  [
    component("source", (await import("./fixtures.js")).metaToGoogleCompound.components[0]!.action,{role:"SOURCE"}),
    component("destination",(await import("./fixtures.js")).metaToGoogleCompound.components[1]!.action,{role:"DESTINATION"}),
  ],
  {
    concurrency:"EFFECTIVE_TOGETHER",
    atomicity:"ALL_OR_NOTHING",
    failurePolicy:"ABORT_COMPOUND",
    constraints:[{constraintId:"conserve_budget",kind:"SUM_MONETARY_DELTAS_EQUALS",currency:"CAD",ratePeriod:"week",amountMinor:0,hard:true}],
  },
);

export const fixture02Campaign=compound(
  "compound_fixture_02_campaign",
  "Run a Collection X promotion, email campaign and Google Shopping budget increase.",
  [
    component("promotion",startAutomaticCollectionX15FourDays,{role:"PRIMARY"}),
    component("email",sendEmailSegmentAFriday10,{role:"SUPPORTING",population:{kind:"OVERRIDE",populationRef:"population:segment-a",bindingTime:"SEND_TIME"}}),
    component("paid_media",increaseGoogleShoppingBudget20,{role:"SUPPORTING"}),
  ],
);

export const fixture03FullCampaign=compound(
  "compound_fixture_03_full_campaign",
  "Run a four-part Fall Collection campaign.",
  [
    component("promotion",startAutomaticCollectionX15FourDays,{role:"PRIMARY"}),
    component("email",sendEmailSegmentAFriday10,{role:"SUPPORTING",population:{kind:"OVERRIDE",populationRef:"population:email-eligible",bindingTime:"SEND_TIME"}}),
    component("paid_media",increaseGoogleShoppingBudget20,{role:"SUPPORTING"}),
    component("merchandising",featureCollectionXHomepageSlot1,{role:"SUPPORTING"}),
  ],
);

export const fixture04InventoryProtection=compound(
  "compound_fixture_04_inventory_protection",
  "Protect low-stock SKU A across inventory, advertising and onsite merchandising.",
  [
    component("protect",protectSkuAAt20,{role:"TRIGGER"}),
    component("pause_ads",pauseSkuAAdvertising,{role:"DEPENDENT"}),
    component("deprioritize",deprioritizeSkuAOnsite,{role:"DEPENDENT"}),
  ],
  {
    atomicity:"DEPENDENCY_GATED",
    failurePolicy:"PAUSE_DEPENDENTS",
    dependencies:[
      {dependencyId:"protect_before_ads",type:"REQUIRES",componentId:"pause_ads",dependsOnComponentId:"protect"},
      {dependencyId:"protect_before_merch",type:"REQUIRES",componentId:"deprioritize",dependsOnComponentId:"protect"},
    ],
  },
);

export const fixture05ClearanceAcceleration=compound(
  "compound_fixture_05_clearance",
  "Accelerate clearance of excess SKU A.",
  [
    component("inventory",accelerateSkuAExcessUntil50,{role:"TRIGGER"}),
    component("price",reduceSkuA20Percent,{role:"PRIMARY"}),
    component("merchandising",featureSkuAInClearance,{role:"SUPPORTING"}),
    component("paid_media",increaseProductWithContributionMarginFloor,{role:"SUPPORTING"}),
  ],
);

const promotionBeforeEmail:[ComponentDependency]=[{dependencyId:"promotion_effective_before_email",type:"EFFECTIVE_AFTER",componentId:"email",dependsOnComponentId:"promotion"}];

export const fixture06PromotionBeforeEmail=compound(
  "compound_fixture_06_promotion_before_email",
  "Make the promotion effective before sending the lifecycle email.",
  [
    component("promotion",startAutomaticCollectionX15FourDays,{role:"TRIGGER"}),
    component("email",sendEmailSegmentAFriday10,{role:"DEPENDENT",timing:{kind:"DEPENDENT",dependencyIds:["promotion_effective_before_email"]},population:{kind:"OVERRIDE",populationRef:"population:email-eligible",bindingTime:"SEND_TIME"}}),
  ],
  {ordering:{kind:"ORDERED",componentIds:["promotion","email"]},dependencies:promotionBeforeEmail,atomicity:"DEPENDENCY_GATED",failurePolicy:"PAUSE_DEPENDENTS"},
);

export const fixture07ConcurrentPaidMedia=compound(
  "compound_fixture_07_concurrent_paid_media",
  "Coordinate two paid-media changes with one effective start.",
  [component("meta",increaseMeta500PerDay),component("google",googleBudgetPlus500PerDay)],
  {concurrency:"EFFECTIVE_TOGETHER"},
);

export const fixture08DifferentPopulations=compound(
  "compound_fixture_08_different_populations",
  "Coordinate components with different explicit customer populations.",
  [
    component("vip_promotion",startVipSegmentA20,{population:{kind:"OVERRIDE",populationRef:"population:vip-a",bindingTime:"EFFECTIVE_TIME"}}),
    component("segment_email",sendEmailSegmentAFriday10,{population:{kind:"OVERRIDE",populationRef:"population:segment-a",bindingTime:"SEND_TIME"}}),
  ],
);

export const fixture09InheritedPopulationOverride=compound(
  "compound_fixture_09_population_inheritance",
  "Use a default population with one explicit component override.",
  [
    component("vip_promotion",startVipSegmentA20,{population:{kind:"INHERIT"}}),
    component("segment_email",sendEmailSegmentAFriday10,{population:{kind:"OVERRIDE",populationRef:"population:segment-a",bindingTime:"SEND_TIME"}}),
  ],
  {defaultPopulation:"population:vip-a"},
);

export const fixture10InheritedTimingDelayedDependent=compound(
  "compound_fixture_10_timing_inheritance",
  "Share campaign timing while delaying the dependent email until the promotion is effective.",
  [
    component("promotion",startAutomaticCollectionX15FourDays,{timing:{kind:"INHERIT"}}),
    component("email",sendEmailSegmentAFriday10,{timing:{kind:"DEPENDENT",dependencyIds:["promo_then_email"]},population:{kind:"OVERRIDE",populationRef:"population:email-eligible",bindingTime:"SEND_TIME"}}),
  ],
  {dependencies:[{dependencyId:"promo_then_email",type:"EFFECTIVE_AFTER",componentId:"email",dependsOnComponentId:"promotion"}],atomicity:"DEPENDENCY_GATED",failurePolicy:"PAUSE_DEPENDENTS"},
);

export const fixture11StateTermination=compound(
  "compound_fixture_11_state_termination",
  "Protect inventory until the first state-based termination condition is reached.",
  [component("protect",protectSkuAAt20),component("pause_ads",pauseSkuAAdvertising)],
  {timing:inventoryFirstOfTerminationTiming,atomicity:"DEPENDENCY_GATED"},
);

export const fixture12RecurringWeekend=compound(
  "compound_fixture_12_recurring_weekend",
  "Every weekend for four weeks run free shipping, homepage merchandising and paid-media support.",
  [
    component("shipping",temporarySitewideFreeFridayMonday),
    component("merchandising",featureCollectionXHomepageSlot1),
    component("paid_media",increaseGoogleShoppingBudget20),
  ],
  {timing:recurringWeekendTiming,concurrency:"START_TOGETHER"},
);

export const fixture13UnsupportedSimulatorComponent=compound(
  "compound_fixture_13_unsupported_component",
  "Promotion plus lifecycle email with explicit simulator capability boundary.",
  [component("promotion",startAutomaticCollectionX15FourDays),component("email",sendEmailSegmentAFriday10,{population:{kind:"OVERRIDE",populationRef:"population:email-eligible",bindingTime:"SEND_TIME"}})],
  {atomicity:"BEST_EFFORT"},
);

export const fixture14AllOrNothingUnsupported=compound(
  "compound_fixture_14_all_or_nothing_unsupported",
  "ALL_OR_NOTHING promotion and lifecycle email.",
  fixture13UnsupportedSimulatorComponent.components,
  {atomicity:"ALL_OR_NOTHING",failurePolicy:"ABORT_COMPOUND"},
);

export const fixture15BestEffortUnsupported=compound(
  "compound_fixture_15_best_effort_unsupported",
  "BEST_EFFORT promotion and lifecycle email.",
  fixture13UnsupportedSimulatorComponent.components,
  {atomicity:"BEST_EFFORT",failurePolicy:"CONTINUE_INDEPENDENT_COMPONENTS"},
);

export const fixture16MixedReversibility=compound(
  "compound_fixture_16_mixed_reversibility",
  "Coordinate a reversible promotion with an irreversible email send.",
  [component("promotion",startAutomaticCollectionX15FourDays),component("email",sendEmailSegmentAFriday10,{population:{kind:"OVERRIDE",populationRef:"population:email-eligible",bindingTime:"SEND_TIME"}})],
  {rollback:{policy:"ROLLBACK_ALL_REVERSIBLE_COMPONENTS",order:"REVERSE_DEPENDENCY_ORDER",irreversibleComponentPolicy:"REQUIRE_COMPENSATION"}},
);

export const fixture17RollbackAllSafe=compound(
  "compound_fixture_17_rollback_all_safe",
  "Temporary price and promotion with conflict-safe reversible components.",
  [component("price",temporarySkuA799SevenDays),component("promotion",startAutomaticCollectionX15FourDays)],
);

export const fixture18RollbackConflict=compound(
  "compound_fixture_18_rollback_conflict",
  "Rollback-ready compound used to preserve a later legitimate component conflict.",
  fixture17RollbackAllSafe.components,
);

export const fixture19RollbackAfterEmailSent=compound(
  "compound_fixture_19_email_irreversible",
  "Rollback a promotion after an email send while preserving irreversible communication semantics.",
  fixture16MixedReversibility.components,
  {rollback:{policy:"ROLLBACK_ALL_REVERSIBLE_COMPONENTS",order:"REVERSE_DEPENDENCY_ORDER",irreversibleComponentPolicy:"REPORT_AND_CONTINUE"}},
);

export const fixture20InvalidCircularDependency:unknown={
  ...fixture06PromotionBeforeEmail,
  compoundActionId:compoundId("compound_fixture_20_invalid_cycle"),
  dependencies:[
    {dependencyId:"a",type:"REQUIRES",componentId:"promotion",dependsOnComponentId:"email"},
    {dependencyId:"b",type:"REQUIRES",componentId:"email",dependsOnComponentId:"promotion"},
  ],
};

export const fixture21InvalidConservation:unknown={
  ...fixture01BudgetReallocation,
  compoundActionId:compoundId("compound_fixture_21_invalid_conservation"),
  constraints:[{constraintId:"broken_conservation",kind:"SUM_MONETARY_DELTAS_EQUALS",currency:"CAD",ratePeriod:"week",amountMinor:1,hard:true}],
};

export const fixture22MediaBudgetConstraintViolation:unknown=compound(
  "compound_fixture_22_media_limit_violation",
  "Two incremental media changes that exceed the compound hard media budget limit.",
  [component("meta",increaseMeta500PerDay),component("google",googleBudgetPlus500PerDay)],
  {constraints:[{constraintId:"media_cap",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE",currency:"CAD",ratePeriod:"day",amountMinor:50_000,hard:true}]},
);

export const fixture23SameActionsDifferentOrder=compound(
  "compound_fixture_23_semantic_order",
  "Same reallocation Actions with an explicit semantic dependency.",
  fixture01BudgetReallocation.components,
  {ordering:{kind:"ORDERED",componentIds:["source","destination"]},dependencies:[{dependencyId:"source_then_destination",type:"EFFECTIVE_AFTER",componentId:"destination",dependsOnComponentId:"source"}],atomicity:"DEPENDENCY_GATED",failurePolicy:"PAUSE_DEPENDENTS"},
);

export const fixture24UnknownEligibility=compound(
  "compound_fixture_24_unknown_eligibility",
  "Compound containing a component whose hard business evidence may be unknown.",
  [component("margin_gated_media",increaseProductWithContributionMarginFloor),component("promotion",startAutomaticCollectionX15FourDays)],
);

export const fixture25NoOpControl=compound(
  "compound_fixture_25_noop_control",
  "Preserve explicit NO_OP control semantics without embedding experiment assignment.",
  [
    component("control",doNothingAction,{role:"CONTROL"}),
    component("treatment_reference",startAutomaticCollectionX15FourDays,{role:"PRIMARY"}),
  ],
);

export const activeWithInvestigationCompound=compound(
  "compound_active_plus_investigation",
  "Reduce Meta spend while separately investigating an attribution anomaly.",
  [component("active",decreaseMetaProspectingBudget500PerDay),component("investigate",investigateTrackingAnomaly,{role:"SUPPORTING"})],
);

export const activeWithWaitObserveCompound=compound(
  "compound_active_plus_wait",
  "Keep one active intervention while another coordinated component waits for evidence.",
  [component("active",increaseGoogleShoppingBudget20),component("wait",waitObserveAction,{role:"SUPPORTING"})],
);

export const canonicalCompoundFixtures:readonly CompoundAction[]=[
  fixture01BudgetReallocation,fixture02Campaign,fixture03FullCampaign,fixture04InventoryProtection,fixture05ClearanceAcceleration,
  fixture06PromotionBeforeEmail,fixture07ConcurrentPaidMedia,fixture08DifferentPopulations,fixture09InheritedPopulationOverride,
  fixture10InheritedTimingDelayedDependent,fixture11StateTermination,fixture12RecurringWeekend,fixture13UnsupportedSimulatorComponent,
  fixture14AllOrNothingUnsupported,fixture15BestEffortUnsupported,fixture16MixedReversibility,fixture17RollbackAllSafe,
  fixture18RollbackConflict,fixture19RollbackAfterEmailSent,fixture23SameActionsDifferentOrder,fixture24UnknownEligibility,
  fixture25NoOpControl,activeWithInvestigationCompound,activeWithWaitObserveCompound,
];

for(const fixture of canonicalCompoundFixtures){
  const result=validateCompoundAction(fixture);
  if(!result.ok)throw new Error("Invalid Step 13 fixture "+fixture.compoundActionId+": "+result.issues.map(x=>x.code).join(", "));
}
