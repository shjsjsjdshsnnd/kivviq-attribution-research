import type { Action, ActionTarget } from "../action_ontology/types.js";

export const OPERATOR_INTERFACE_VERSION = "1.0.0" as const;

export type OperatorType = "baseline" | "decision_system";

export type OperatorJson =
  | null
  | boolean
  | number
  | string
  | readonly OperatorJson[]
  | { readonly [key: string]: OperatorJson };

export interface SupportedEvaluationContract {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractFingerprint: string;
  readonly frozenCommit: string;
}

export interface CanonicalOperatorMetadata {
  readonly interfaceVersion: typeof OPERATOR_INTERFACE_VERSION;
  readonly operatorId: string;
  readonly operatorType: OperatorType;
  readonly operatorVersion: string;
  readonly description: string;
  readonly supportedEvaluationContract: SupportedEvaluationContract;
  readonly supportedActionOntologyVersion: string;
  readonly deterministicConfiguration: OperatorJson;
  readonly implementationFingerprint: string;
}

export type OperatorObservationInformationClass =
  | "observable_merchant_data"
  | "derived_observable_metric"
  | "historical_information"
  | "current_state_information";

export interface OperatorObservationRecord {
  readonly observationKey: string;
  readonly informationClass: OperatorObservationInformationClass;
  readonly sourceMinOccurredAt: string;
  readonly sourceMaxOccurredAt: string;
  readonly availableAt: string;
  readonly sourceRef: string;
  readonly value: unknown;
}

export interface OperatorParameterBound {
  readonly path: string;
  readonly minInclusive?: number;
  readonly maxInclusive?: number;
}

export interface OperatorLegalActionRule {
  readonly actionType: string;
  readonly eligibleTargets: readonly ActionTarget[];
  readonly parameterBounds: readonly OperatorParameterBound[];
  readonly requiredPreconditionIds: readonly string[];
}

export interface OperatorMutualExclusionGroup {
  readonly groupId: string;
  readonly actionTypes: readonly string[];
}

export interface OperatorDecisionInput {
  readonly opportunityId: string;
  readonly decisionTime: string;
  readonly observation: {
    readonly records: readonly OperatorObservationRecord[];
  };
  readonly legalActionSpace: {
    readonly rules: readonly OperatorLegalActionRule[];
    readonly mutualExclusionGroups: readonly OperatorMutualExclusionGroup[];
  };
}

export interface OperatorDecisionOutput {
  readonly actions: readonly Action[];
}

export interface CanonicalOperator {
  readonly metadata: CanonicalOperatorMetadata;
  decide(input: Readonly<OperatorDecisionInput>): OperatorDecisionOutput;
}
