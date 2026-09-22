import type {
  Action,
  MerchandisingEntityTarget,
  MerchandisingSurface,
  UtcTimestamp,
} from "../action_ontology/types.js";

export interface MerchandisingRankingSnapshot {
  readonly bindingRef: string;
  readonly evaluateAt: "decision_time" | "translation_time" | "effective_time";
  readonly snapshotTime: UtcTimestamp;
  readonly sourceRef: string;
  readonly surface: MerchandisingSurface;
  readonly orderedEntities: readonly MerchandisingEntityTarget[];
}

export interface MerchandisingSurfaceDefinition {
  readonly surface: MerchandisingSurface;
  readonly sourceRef: string;
  readonly capacity?: number;
  readonly namedSlotIds?: readonly string[];
}

export interface MerchandisingEligibilityContext {
  readonly rankingSnapshots?: readonly MerchandisingRankingSnapshot[];
  readonly surfaceDefinitions?: readonly MerchandisingSurfaceDefinition[];
  readonly inventoryUnitsByEntity?: Readonly<Record<string, number>>;
  readonly hardConstraintResults?: Readonly<
    Record<string, "satisfied" | "violated" | "unknown">
  >;
}

export type MerchandisingEligibilityDecision =
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

export type MerchandisingRankResolution =
  | {
      readonly status: "RESOLVED";
      readonly targetPosition: number;
      readonly currentPosition?: number;
      readonly resultingOrder?: readonly MerchandisingEntityTarget[];
      readonly snapshotRef?: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly code:
        | "MISSING_RANKING_SNAPSHOT"
        | "RANKED_ENTITY_NOT_IN_SNAPSHOT";
      readonly missingRef: string;
    }
  | {
      readonly status: "INVALID";
      readonly code: "TARGET_POSITION_OUT_OF_RANGE";
    };

export interface MerchandisingRollbackStateContext {
  readonly currentPosition?: number;
  readonly rankingSnapshots?: readonly MerchandisingRankingSnapshot[];
}

export type MerchandisingRollbackReadiness =
  | {
      readonly status: "READY";
      readonly rollbackActionId: string;
      readonly originalActionId: string;
      readonly position: number;
      readonly sourceRef: string;
    }
  | {
      readonly status: "CONFLICT";
      readonly rollbackActionId: string;
      readonly code: "CURRENT_RANK_CHANGED_AFTER_ORIGINAL_ACTION";
      readonly message: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly rollbackActionId: string;
      readonly code:
        | "MISSING_CURRENT_POSITION"
        | "MISSING_RANKING_SNAPSHOT"
        | "RANKED_ENTITY_NOT_IN_SNAPSHOT";
      readonly message: string;
    }
  | {
      readonly status: "INVALID_ACTION";
      readonly code: string;
      readonly message: string;
    };

export type MerchandisingConflictAssessment =
  | { readonly status: "COEXIST" }
  | {
      readonly status: "RESOLVABLE";
      readonly strategy: "PRECEDENCE" | "MUTUALLY_EXCLUSIVE_GROUP";
      readonly winnerActionId?: string;
      readonly groupId?: string;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly code: "EXCLUSIVE_MERCHANDISING_PLACEMENT_CONFLICT";
    };
