import type { Action } from "../action_ontology/types.js";
import type { ActionTiming } from "../action_timing/types.js";

export const COMPOUND_ACTION_SCHEMA_VERSION = "1.0.0" as const;
export type CompoundActionId = string & { readonly __brand: "CompoundActionId" };
export type CompoundComponentRole = "SOURCE"|"DESTINATION"|"PRIMARY"|"SUPPORTING"|"TRIGGER"|"DEPENDENT"|"CONTROL";
export type PopulationBinding =
  | {readonly kind:"INHERIT"}
  | {readonly kind:"OVERRIDE";readonly populationRef:string;readonly bindingTime?:"DECISION_TIME"|"EFFECTIVE_TIME"|"SEND_TIME"|"TRIGGER_TIME"}
  | {readonly kind:"NOT_APPLICABLE";readonly reason:string};
export type ComponentTimingBinding =
  | {readonly kind:"INHERIT"}
  | {readonly kind:"OVERRIDE";readonly timing:ActionTiming}
  | {readonly kind:"DEPENDENT";readonly dependencyIds:readonly string[]};

export interface CompoundActionComponent {
  readonly componentId:string;
  readonly action:Action;
  readonly role?:CompoundComponentRole;
  readonly population:PopulationBinding;
  readonly timing:ComponentTimingBinding;
}
export type ComponentDependencyType="START_AFTER"|"EFFECTIVE_AFTER"|"COMPLETE_AFTER"|"REQUIRES"|"END_WITH";
export interface ComponentDependency {
  readonly dependencyId:string;
  readonly type:ComponentDependencyType;
  readonly componentId:string;
  readonly dependsOnComponentId:string;
}
export type CompoundOrdering={readonly kind:"UNORDERED"}|{readonly kind:"ORDERED";readonly componentIds:readonly string[]};
export type CompoundConcurrency="START_TOGETHER"|"EFFECTIVE_TOGETHER"|"INDEPENDENT_TIMING";
export type CompoundAtomicity="ALL_OR_NOTHING"|"BEST_EFFORT"|"DEPENDENCY_GATED";
export type CompoundFailurePolicy="ABORT_COMPOUND"|"CONTINUE_INDEPENDENT_COMPONENTS"|"ROLLBACK_COMPLETED_COMPONENTS"|"PAUSE_DEPENDENTS";
export type CompoundRollbackPolicy="ROLLBACK_ALL_REVERSIBLE_COMPONENTS"|"ROLLBACK_COMPLETED_COMPONENTS"|"ROLLBACK_DEPENDENT_COMPONENTS"|"NO_AUTOMATIC_ROLLBACK";
export type CompoundRollbackOrder="REVERSE_DEPENDENCY_ORDER"|"EXPLICIT"|"UNORDERED";
export type CompoundCompletionRule="ALL_COMPONENTS_COMPLETE"|"ALL_REQUIRED_COMPONENTS_COMPLETE";
export type CompoundConstraint =
  | {readonly constraintId:string;readonly kind:"SUM_MONETARY_DELTAS_EQUALS";readonly currency:string;readonly ratePeriod:"day"|"week"|"month";readonly amountMinor:number;readonly hard:true}
  | {readonly constraintId:string;readonly kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE";readonly currency:string;readonly ratePeriod:"day"|"week"|"month";readonly amountMinor:number;readonly hard:true}
  | {readonly constraintId:string;readonly kind:"TOTAL_DISCOUNT_EXPOSURE_LTE";readonly currency:string;readonly amountMinor:number;readonly hard:true}
  | {readonly constraintId:string;readonly kind:"MINIMUM_CONTRIBUTION_GTE";readonly currency:string;readonly amountMinor:number;readonly hard:true};
export interface CompoundMeasurementHorizon {
  readonly earliestMeaningfulEvaluationSeconds:number;
  readonly primaryEvaluationSeconds:number;
  readonly longTermFollowUpSeconds?:number;
  readonly metricIds:readonly string[];
}
export interface CompoundProvenance {
  readonly source:"human"|"rule_based_baseline"|"diagnosis_engine"|"opportunity_engine"|"optimizer"|"experiment_selector"|"imported_manual";
  readonly sourceId?:string;
  readonly createdAt:string;
  readonly evidenceRefs:readonly string[];
}
export interface CompoundAction {
  readonly kind:"compound_action";
  readonly compoundActionId:CompoundActionId;
  readonly schemaVersion:typeof COMPOUND_ACTION_SCHEMA_VERSION;
  readonly description:string;
  readonly intent:string;
  readonly components:readonly CompoundActionComponent[];
  readonly ordering:CompoundOrdering;
  readonly concurrency:CompoundConcurrency;
  readonly dependencies:readonly ComponentDependency[];
  readonly atomicity:CompoundAtomicity;
  readonly failurePolicy:CompoundFailurePolicy;
  readonly completionRule:CompoundCompletionRule;
  readonly defaultPopulation?:string;
  readonly timing?:ActionTiming;
  readonly constraints:readonly CompoundConstraint[];
  readonly rollback:{
    readonly policy:CompoundRollbackPolicy;
    readonly order:CompoundRollbackOrder;
    readonly explicitComponentOrder?:readonly string[];
    readonly irreversibleComponentPolicy:"REPORT_AND_CONTINUE"|"BLOCK_AUTOMATIC_ROLLBACK"|"REQUIRE_COMPENSATION";
  };
  readonly measurement:CompoundMeasurementHorizon;
  readonly provenance:CompoundProvenance;
}
export type ComponentReadinessState="READY"|"INELIGIBLE"|"UNKNOWN"|"UNSUPPORTED_SIMULATOR_CAPABILITY"|"UNSUPPORTED_EXECUTION_CAPABILITY"|"MISSING_CONTEXT"|"UNRESOLVED_POPULATION"|"UNRESOLVED_TIMING"|"INVALID";
export interface CompoundComponentReadiness {readonly componentId:string;readonly actionId:string;readonly state:ComponentReadinessState;readonly reasons:readonly string[]}
export type CompoundReadinessState="READY"|"PARTIALLY_READY"|"BLOCKED"|"UNKNOWN";
export interface CompoundActionReadiness {readonly compoundActionId:CompoundActionId;readonly state:CompoundReadinessState;readonly components:readonly CompoundComponentReadiness[];readonly unresolvedDependencies:readonly string[];readonly constraintFailures:readonly string[]}
export type CompoundReversibilitySummary="FULLY_REVERSIBLE"|"PARTIALLY_REVERSIBLE"|"IRREVERSIBLE";
export interface CompoundRollbackComponentReadiness {readonly componentId:string;readonly actionId:string;readonly state:"ROLLBACKABLE"|"IRREVERSIBLE"|"CONFLICT"|"MISSING_CONTEXT"|"UNKNOWN";readonly reasons:readonly string[]}
export interface CompoundRollbackReadiness {readonly compoundActionId:CompoundActionId;readonly overall:"READY"|"PARTIAL"|"BLOCKED"|"UNKNOWN";readonly reversibility:CompoundReversibilitySummary;readonly components:readonly CompoundRollbackComponentReadiness[];readonly requiredRollbackOrder:readonly string[];readonly compensationRequired:boolean;readonly missingContext:readonly string[];readonly conflicts:readonly string[];readonly compensationRequirements:readonly CompensationRequirement[]}
export interface FlattenedCompoundComponent {readonly compoundActionId:CompoundActionId;readonly componentId:string;readonly componentIndex:number;readonly role?:CompoundComponentRole;readonly action:Action;readonly dependencies:readonly ComponentDependency[];readonly population:PopulationBinding;readonly timing:ComponentTimingBinding}

export interface CompoundCostDimensionAggregate {
  readonly dimension:"directFinancialCost"|"mediaSpend"|"implementationCost"|"engineeringCost"|"operationalCost"|"promotionalCost"|"inventoryCommitment";
  readonly status:"AGGREGATED"|"UNKNOWN"|"MIXED_CURRENCY";
  readonly currency?:string;
  readonly amountMinor?:number;
  readonly componentValues:readonly {readonly componentId:string;readonly state:"KNOWN"|"UNKNOWN";readonly currency?:string;readonly amountMinor?:number;readonly reason?:string}[];
}
export interface CompoundCostSummary {
  readonly compoundActionId:CompoundActionId;
  readonly dimensions:readonly CompoundCostDimensionAggregate[];
}
export interface CompoundResourceAggregate {
  readonly resourceType:string;
  readonly status:"AGGREGATED"|"UNKNOWN"|"INCOMPATIBLE_UNITS";
  readonly kind?:string;
  readonly unit?:string;
  readonly currency?:string;
  readonly amount?:number;
  readonly componentIds:readonly string[];
}
export interface CompoundResourceSummary {
  readonly compoundActionId:CompoundActionId;
  readonly aggregates:readonly CompoundResourceAggregate[];
}
export interface CompoundRiskSummary {
  readonly compoundActionId:CompoundActionId;
  readonly dimensions:readonly string[];
  readonly components:readonly {readonly componentId:string;readonly risks:readonly {readonly dimension:string;readonly downsideDefinition:string}[]}[];
}
export interface CompoundPopulationComponentResolution {
  readonly componentId:string;
  readonly status:"REFERENCE_BOUND"|"NOT_APPLICABLE"|"UNKNOWN";
  readonly populationRef?:string;
  readonly bindingTime?:"DECISION_TIME"|"EFFECTIVE_TIME"|"SEND_TIME"|"TRIGGER_TIME";
  readonly source:"COMPOUND_DEFAULT"|"COMPONENT_OVERRIDE"|"NOT_APPLICABLE"|"UNRESOLVED";
  readonly reason?:string;
}
export interface CompoundPopulationResolution {
  readonly compoundActionId:CompoundActionId;
  readonly components:readonly CompoundPopulationComponentResolution[];
}
export interface CompoundTimingComponentResolution {
  readonly componentId:string;
  readonly status:"RESOLVED"|"UNRESOLVED"|"INVALID";
  readonly inherited:boolean;
  readonly resolution?:import("../action_timing/types.js").TimingResolution;
  readonly dependencyIds:readonly string[];
  readonly reasons:readonly string[];
}
export interface CompoundTimingResolution {
  readonly compoundActionId:CompoundActionId;
  readonly compound?:import("../action_timing/types.js").TimingResolution;
  readonly components:readonly CompoundTimingComponentResolution[];
  readonly unresolvedDependencies:readonly string[];
  readonly ordering:readonly string[];
}
export interface CompensationRequirement {
  readonly componentId:string;
  readonly actionId:string;
  readonly required:boolean;
  readonly reason:string;
}
