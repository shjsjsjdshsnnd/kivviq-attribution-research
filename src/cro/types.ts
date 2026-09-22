import type {
  Action,
  CroCapability,
  CroComponentTarget,
  CroDevice,
  CroPageScope,
  CroSurface,
} from "../action_ontology/types.js";
import type { UtcTimestamp } from "../core/units.js";

export interface CroStructureSnapshot {
  readonly bindingRef: string;
  readonly evaluateAt: "decision_time" | "translation_time" | "effective_time";
  readonly snapshotTime: UtcTimestamp;
  readonly sourceRef: string;
  readonly surface: CroSurface;
  readonly pageScope: CroPageScope;
  readonly device: CroDevice;
  readonly orderedComponents: readonly CroComponentTarget[];
}

export interface CroComponentState {
  readonly component: CroComponentTarget;
  readonly stateRef: string;
}

export interface CroExperienceState {
  readonly surface: CroSurface;
  readonly pageScope: CroPageScope;
  readonly device: CroDevice;
  readonly sourceRef: string;
  readonly presentComponents: readonly CroComponentTarget[];
  readonly capabilities: readonly CroCapability[];
  readonly componentStates?: readonly CroComponentState[];
  readonly performanceConfigurationRef?: string;
}

export interface CroEligibilityContext {
  readonly structures?: readonly CroStructureSnapshot[];
  readonly experiences?: readonly CroExperienceState[];
  readonly audienceMembershipBindingRefs?: readonly string[];
  readonly hardConstraintResults?: Readonly<
    Record<string, "satisfied" | "violated" | "unknown">
  >;
}

export type CroEligibilityDecision =
  | {
      readonly status: "eligible";
      readonly reasonCodes: readonly [];
      readonly missingInformation: readonly [];
    }
  | {
      readonly status: "ineligible" | "unknown";
      readonly reasonCodes: readonly string[];
      readonly missingInformation: readonly string[];
    };

export type CroOrderingResolution =
  | {
      readonly status: "RESOLVED";
      readonly targetPosition: number;
      readonly currentPosition?: number;
      readonly resultingOrder?: readonly CroComponentTarget[];
      readonly snapshotRef?: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly code:
        | "MISSING_CRO_STRUCTURE_SNAPSHOT"
        | "CRO_COMPONENT_NOT_IN_STRUCTURE"
        | "CRO_REFERENCE_COMPONENT_NOT_IN_STRUCTURE"
        | "CRO_STRUCTURE_CONTEXT_MISMATCH";
      readonly missingRef: string;
    }
  | {
      readonly status: "INVALID";
      readonly code: "CRO_POSITION_OUT_OF_RANGE";
    };

export interface CroExperienceStateSnapshot {
  readonly stateSnapshotRef: string;
  readonly stateRef: string;
  readonly sourceRef: string;
}

export interface CroRollbackStateContext {
  readonly currentStateRef?: string;
  readonly stateSnapshots?: readonly CroExperienceStateSnapshot[];
}

export type CroRollbackReadiness =
  | {
      readonly status: "READY";
      readonly rollbackActionId: string;
      readonly originalActionId: string;
      readonly stateRef: string;
      readonly sourceRef: string;
    }
  | {
      readonly status: "CONFLICT";
      readonly rollbackActionId: string;
      readonly code: "CURRENT_EXPERIENCE_CHANGED_AFTER_ORIGINAL_ACTION";
      readonly message: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly rollbackActionId: string;
      readonly code:
        | "MISSING_CURRENT_EXPERIENCE_STATE"
        | "MISSING_CRO_STATE_SNAPSHOT";
      readonly message: string;
    }
  | {
      readonly status: "INVALID_ACTION";
      readonly code: string;
      readonly message: string;
    };

export type CroConflictAssessment =
  | { readonly status: "COEXIST" }
  | {
      readonly status: "RESOLVABLE";
      readonly strategy: "PRECEDENCE" | "MUTUALLY_EXCLUSIVE_GROUP";
      readonly winnerActionId?: string;
      readonly groupId?: string;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly code: "CRO_PAGE_STRUCTURE_CONFLICT";
    };

export interface CroFutureVariantBinding {
  readonly variantId: string;
  readonly actionId: Action["actionId"];
  readonly boundDimensions: readonly string[];
  readonly implementationRef: string;
}
