import { utcTimestamp } from "../core/units.js";
import { metaToGoogle2000PerWeek } from "../paid_media/fixtures.js";
import { fridaySevenDayBudgetTiming } from "../action_timing/fixtures.js";
import { COMPOUND_ACTION_SCHEMA_VERSION, type CompoundAction, type CompoundActionId } from "./types.js";
import { validateCompoundAction } from "./validation.js";

function id(value:string):CompoundActionId{return value as CompoundActionId}
const [metaDown,googleUp]=metaToGoogle2000PerWeek.components;
if(!metaDown||!googleUp)throw new Error("paid-media fixture must contain two legs");

export const metaToGoogleCompound:CompoundAction={
  kind:"compound_action",
  compoundActionId:id("compound_meta_google_2000_week"),
  schemaVersion:COMPOUND_ACTION_SCHEMA_VERSION,
  description:"Move CAD 2,000/week from Meta to Google.",
  intent:"Reallocate an existing paid-media budget without changing total weekly spend.",
  components:[
    {componentId:"meta_source",action:metaDown,role:"SOURCE",population:{kind:"NOT_APPLICABLE",reason:"paid-media channel budget is not a first-party customer population"},timing:{kind:"INHERIT"}},
    {componentId:"google_destination",action:googleUp,role:"DESTINATION",population:{kind:"NOT_APPLICABLE",reason:"paid-media channel budget is not a first-party customer population"},timing:{kind:"INHERIT"}},
  ],
  ordering:{kind:"UNORDERED"},
  concurrency:"EFFECTIVE_TOGETHER",
  dependencies:[],
  atomicity:"ALL_OR_NOTHING",
  failurePolicy:"ABORT_COMPOUND",
  completionRule:"ALL_COMPONENTS_COMPLETE",
  timing:fridaySevenDayBudgetTiming,
  constraints:[{constraintId:"conserve_weekly_media_budget",kind:"SUM_MONETARY_DELTAS_EQUALS",currency:"CAD",ratePeriod:"week",amountMinor:0,hard:true}],
  rollback:{policy:"ROLLBACK_ALL_REVERSIBLE_COMPONENTS",order:"REVERSE_DEPENDENCY_ORDER",irreversibleComponentPolicy:"REPORT_AND_CONTINUE"},
  measurement:{earliestMeaningfulEvaluationSeconds:86400,primaryEvaluationSeconds:14*86400,metricIds:["paid_media_spend","orders"]},
  provenance:{source:"human",createdAt:utcTimestamp("2026-09-23T11:45:00.000Z"),evidenceRefs:[]},
};

export const orderedMetaThenGoogleCompound:CompoundAction={
  ...metaToGoogleCompound,
  compoundActionId:id("compound_meta_then_google_2000_week"),
  ordering:{kind:"ORDERED",componentIds:["meta_source","google_destination"]},
  concurrency:"INDEPENDENT_TIMING",
  dependencies:[{dependencyId:"google_after_meta",type:"EFFECTIVE_AFTER",componentId:"google_destination",dependsOnComponentId:"meta_source"}],
  atomicity:"DEPENDENCY_GATED",
  failurePolicy:"PAUSE_DEPENDENTS",
};

const validation=validateCompoundAction(metaToGoogleCompound);
if(!validation.ok)throw new Error("invalid canonical Step 13 fixture: "+validation.issues.map(x=>x.code).join(", "));
