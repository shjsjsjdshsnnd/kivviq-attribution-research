import type { UtcTimestamp } from "../core/units.js";
import type {
  Action,
  ActionId,
  ActionTarget,
  CompoundAction,
  MonetaryValue,
  InventoryBackorderPolicy,
  InventoryLeadTimeAssumption,
  InventorySupplierConstraints,
  MembershipEvaluationBoundary,
  MerchandisingEntityTarget,
  MerchandisingSurface,
  PricingMembershipBoundary,
  ReferenceValue,
  ScalarValue,
} from "../action_ontology/types.js";
import type {
  SimulatorIntervention,
  SimulatorTarget,
} from "../simulator_intervention/types.js";

export const ACTION_TRANSLATION_VERSION = "1.0.0" as const;
export const TRANSLATION_CONTEXT_SCHEMA_VERSION = "1.4.0" as const;
export const SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS = [
  "1.0.0",
  "1.1.0",
  "1.2.0",
  "1.3.0",
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
] as const;

export const SIMULATOR_CAPABILITIES = [
  "campaign_budget",
  "campaign_delivery",
  "product_price",
  "promotion_discount",
  "merchandising_position",
] as const;

export type SimulatorCapability = (typeof SIMULATOR_CAPABILITIES)[number];

export interface TranslationEntityMapping {
  readonly actionTarget: ActionTarget;
  readonly simulatorTarget: SimulatorTarget;
  readonly sourceRef: string;
}

export interface TranslationReferenceBinding {
  readonly actionId: ActionId;
  readonly reference: ReferenceValue;
  readonly value: ScalarValue;
  readonly sourceRef: string;
}


export interface PricingMembershipMemberBinding {
  readonly skuTarget: Extract<ActionTarget, { readonly kind: "sku" }>;
  readonly simulatorTarget: Extract<SimulatorTarget, { readonly kind: "sku" }>;
  readonly priceAtBoundary: MonetaryValue;
  readonly priceSourceRef: string;
}

export interface PricingMembershipBinding {
  readonly actionTarget:
    | Extract<ActionTarget, { readonly kind: "product" }>
    | Extract<ActionTarget, { readonly kind: "category" }>
    | Extract<ActionTarget, { readonly kind: "collection" }>;
  readonly evaluateAt: PricingMembershipBoundary;
  readonly bindingRef: string;
  readonly snapshotTime: UtcTimestamp;
  readonly sourceRef: string;
  readonly members: readonly PricingMembershipMemberBinding[];
}


export interface PromotionMembershipMemberBinding {
  readonly businessTarget:
    | Extract<ActionTarget, { readonly kind: "sku" }>
    | Extract<ActionTarget, { readonly kind: "product" }>;
  readonly simulatorTarget:
    | Extract<SimulatorTarget, { readonly kind: "sku" }>
    | Extract<SimulatorTarget, { readonly kind: "product" }>;
  readonly sourceRef: string;
}

export interface PromotionMembershipBinding {
  readonly promotionId: string;
  readonly evaluateAt: MembershipEvaluationBoundary;
  readonly bindingRef: string;
  readonly snapshotTime: UtcTimestamp;
  readonly sourceRef: string;
  readonly members: readonly PromotionMembershipMemberBinding[];
}


export interface MerchandisingRankingSnapshotBinding {
  readonly bindingRef: string;
  readonly evaluateAt:
    | "decision_time"
    | "translation_time"
    | "effective_time";
  readonly snapshotTime: UtcTimestamp;
  readonly sourceRef: string;
  readonly surface: MerchandisingSurface;
  readonly orderedEntities: readonly MerchandisingEntityTarget[];
}

export interface MerchandisingSurfaceDefinitionBinding {
  readonly surface: MerchandisingSurface;
  readonly sourceRef: string;
  readonly capacity?: number;
  readonly namedSlotIds?: readonly string[];
}


export interface InventoryTranslationStateBinding {
  readonly target:
    | Extract<ActionTarget,{readonly kind:"sku"}>
    | Extract<ActionTarget,{readonly kind:"product"}>
    | Extract<ActionTarget,{readonly kind:"inventory_policy"}>;
  readonly inventoryLocationId?: string;
  readonly supplierRelationshipId?: string;
  readonly onHandUnits?: number;
  readonly availableToSellUnits?: number;
  readonly reservedUnits?: number;
  readonly safetyStockUnits?: number;
  readonly reorderPointUnits?: number;
  readonly currentReorderQuantity?: number;
  readonly currentPlannedReorderAt?: UtcTimestamp;
  readonly backorderPolicy?: InventoryBackorderPolicy;
  readonly openPurchaseOrderUnits?: number;
  readonly supplierAvailableUnits?: number;
  readonly warehouseAvailableCapacityUnits?: number;
  readonly supplierConstraints?: InventorySupplierConstraints;
  readonly leadTimeAssumption?: InventoryLeadTimeAssumption;
  readonly sourceRef: string;
}

export interface TranslationContext {
  readonly schemaVersion:
    (typeof SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS)[number];
  readonly simulatorClock: UtcTimestamp;
  readonly capabilities: readonly SimulatorCapability[];
  readonly entityMappings: readonly TranslationEntityMapping[];
  readonly referenceBindings: readonly TranslationReferenceBinding[];
  readonly pricingMembershipBindings?: readonly PricingMembershipBinding[];
  readonly promotionMembershipBindings?: readonly PromotionMembershipBinding[];
  readonly merchandisingRankingSnapshots?: readonly MerchandisingRankingSnapshotBinding[];
  readonly merchandisingSurfaceDefinitions?: readonly MerchandisingSurfaceDefinitionBinding[];
  readonly inventoryStateBindings?: readonly InventoryTranslationStateBinding[];
}

export interface ResolvedCompoundBusinessAction {
  readonly kind: "resolved_compound_business_action";
  readonly compoundAction: CompoundAction;
  readonly components: readonly Action[];
}

export type BusinessActionTranslationInput =
  | Action
  | ResolvedCompoundBusinessAction;

export type TranslationFailureStatus =
  | "UNSUPPORTED_ACTION_TYPE"
  | "UNSUPPORTED_TARGET"
  | "UNSUPPORTED_SIMULATOR_CAPABILITY"
  | "MISSING_CONTEXT"
  | "INVALID_ACTION"
  | "AMBIGUOUS_TRANSLATION";

export interface TranslationFailure {
  readonly status: TranslationFailureStatus;
  readonly actionId?: string;
  readonly code: string;
  readonly message: string;
  readonly missingContextRefs?: readonly string[];
}

export interface TranslatedResult {
  readonly status: "TRANSLATED";
  readonly originatingBusinessActionId: string;
  readonly translationVersion: typeof ACTION_TRANSLATION_VERSION;
  readonly interventions: readonly SimulatorIntervention[];
}

export interface ExperimentTranslationReadiness {
  readonly status: "EXPERIMENT_REQUIRES_ENGINE";
  readonly originatingBusinessActionId: string;
  readonly translationVersion: typeof ACTION_TRANSLATION_VERSION;
  readonly experiment: {
    readonly actionId: string;
    readonly hypothesisRef: string;
    readonly interventionActionId: string;
    readonly controlActionId: string;
    readonly targetPopulationRef: string;
    readonly durationSeconds: number;
    readonly primaryOutcomeMetricId: string;
  };
}

export type TranslationResult =
  | TranslatedResult
  | TranslationFailure
  | ExperimentTranslationReadiness;

export interface TranslationOrigin {
  readonly originatingBusinessActionId: string;
  readonly sourceActionId: string;
  readonly componentIndex: number;
  readonly componentCount: number;
}

export interface TranslationSuccessDraft {
  readonly status: "TRANSLATED";
  readonly interventions: readonly SimulatorIntervention[];
}

export type AtomicTranslatorResult =
  | TranslationSuccessDraft
  | TranslationFailure
  | ExperimentTranslationReadiness;

export interface ActionTranslator {
  readonly actionType: string;
  readonly translatorId: string;
  readonly translationVersion: typeof ACTION_TRANSLATION_VERSION;
  readonly supportedTargetKinds: readonly ActionTarget["kind"][];
  readonly requiredCapability?: SimulatorCapability;
  readonly translate: (
    action: Action,
    context: TranslationContext,
    origin: TranslationOrigin,
  ) => AtomicTranslatorResult;
}

export interface TranslationRegistry {
  readonly translators: readonly ActionTranslator[];
}
