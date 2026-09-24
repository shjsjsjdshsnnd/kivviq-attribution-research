import type {
  Action,
  LifecycleChannel,
  LifecycleEvent,
  LifecyclePolicyRollbackValue,
} from "../action_ontology/types.js";
import type { UtcTimestamp } from "../core/units.js";

export interface LifecycleChannelEvidence {
  readonly channel: LifecycleChannel;
  readonly consentEligible?: boolean;
  readonly validDestination?: boolean;
  readonly channelSuppressed?: boolean;
}

export interface LifecycleKnownEvent {
  readonly event: LifecycleEvent;
  readonly occurredAt: UtcTimestamp;
}

export interface LifecycleContactPolicyEvaluation {
  readonly contactPolicyId: string;
  readonly decision: "ALLOW" | "BLOCK" | "UNKNOWN";
}

export interface LifecycleEligibilityContext {
  readonly evaluationBoundary:
    | "DECISION_TIME"
    | "SEND_TIME"
    | "TRIGGER_TIME";
  readonly segmentIds?: readonly string[];
  readonly membershipBindingRefs?: readonly string[];
  readonly purchaseCount?: number;
  readonly daysSinceLastPurchase?: number;
  readonly daysSinceLastEngagement?: number;
  readonly currentFlowIds?: readonly string[];
  readonly channelEvidence?: readonly LifecycleChannelEvidence[];
  readonly contactPolicies?: readonly LifecycleContactPolicyEvaluation[];
  readonly knownEvents?: readonly LifecycleKnownEvent[];
  readonly hardConstraintResults?: Readonly<
    Record<string, "satisfied" | "violated" | "unknown">
  >;
}

export interface LifecycleEligibilityDecision {
  readonly status: "eligible" | "ineligible" | "unknown";
  readonly reasonCodes: readonly string[];
  readonly missingInformation: readonly string[];
}

export interface LifecyclePolicySnapshot {
  readonly baselineId: string;
  readonly value: LifecyclePolicyRollbackValue;
  readonly sourceRef: string;
}

export interface LifecycleRollbackStateContext {
  readonly currentValue?: LifecyclePolicyRollbackValue;
  readonly policySnapshots?: readonly LifecyclePolicySnapshot[];
}

export type LifecycleRollbackReadiness =
  | {
      readonly status: "READY";
      readonly rollbackActionId: string;
      readonly originalActionId: string;
      readonly value: LifecyclePolicyRollbackValue;
      readonly sourceRef: string;
    }
  | {
      readonly status: "CONFLICT";
      readonly rollbackActionId: string;
      readonly code: "CURRENT_LIFECYCLE_POLICY_CHANGED_AFTER_ORIGINAL_ACTION";
      readonly message: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly rollbackActionId: string;
      readonly code:
        | "MISSING_CURRENT_LIFECYCLE_POLICY"
        | "MISSING_LIFECYCLE_POLICY_SNAPSHOT";
      readonly message: string;
    }
  | {
      readonly status: "INVALID_ACTION";
      readonly code: string;
      readonly message: string;
    };

export type LifecycleFlowConflictAssessment =
  | { readonly status: "COEXIST" }
  | {
      readonly status: "RESOLVABLE";
      readonly strategy:
        | "PRECEDENCE"
        | "MUTUALLY_EXCLUSIVE_GROUP"
        | "CONTACT_POLICY";
      readonly winnerActionId?: string;
      readonly groupId?: string;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly code: "LIFECYCLE_FLOW_CONTACT_CONFLICT";
    };

export interface LifecycleMessageSpecificationBoundary {
  readonly messageSpecId: string;
  readonly actionId: Action["actionId"];
  readonly creativeRef: string;
}
