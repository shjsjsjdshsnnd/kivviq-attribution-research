import type { CurrencyCode, UtcTimestamp } from "../core/units.js";

export const SIMULATOR_INTERVENTION_SCHEMA_VERSION = "1.0.0" as const;
export type SimulatorInterventionSchemaVersion =
  typeof SIMULATOR_INTERVENTION_SCHEMA_VERSION;

export const SIMULATOR_INTERVENTION_TYPES = [
  "budget",
  "campaign_delivery",
  "price",
  "promotion_discount",
  "merchandising_position",
] as const;

export type SimulatorInterventionType =
  (typeof SIMULATOR_INTERVENTION_TYPES)[number];

export type SimulatorTarget =
  | {
      readonly kind: "channel";
      readonly simulatorChannelId: string;
    }
  | {
      readonly kind: "campaign";
      readonly simulatorChannelId: string;
      readonly simulatorCampaignId: string;
    }
  | {
      readonly kind: "product";
      readonly simulatorProductId: string;
    }
  | {
      readonly kind: "sku";
      readonly simulatorSkuId: string;
      readonly simulatorProductId?: string;
    }
  | {
      readonly kind: "category";
      readonly simulatorCategoryId: string;
    }
  | {
      readonly kind: "collection";
      readonly simulatorCollectionId: string;
    }
  | {
      readonly kind: "page";
      readonly simulatorPageId: string;
    }
  | {
      readonly kind: "merchant";
      readonly simulatorMerchantId: string;
    };

export type SimulatorScopeDimension =
  | {
      readonly kind: "geography";
      readonly include: readonly string[];
      readonly exclude?: readonly string[];
    }
  | {
      readonly kind: "device";
      readonly devices: readonly ("desktop" | "mobile" | "tablet" | "other")[];
    }
  | {
      readonly kind: "customer_population";
      readonly segmentIds: readonly string[];
    }
  | {
      readonly kind: "product_population";
      readonly productIds?: readonly string[];
      readonly skuIds?: readonly string[];
      readonly collectionIds?: readonly string[];
    }
  | {
      readonly kind: "channel_subset";
      readonly channelIds: readonly string[];
      readonly campaignIds?: readonly string[];
    }
  | {
      readonly kind: "time_window";
      readonly start: UtcTimestamp;
      readonly end: UtcTimestamp;
    };

export interface SimulatorScope {
  readonly dimensions: readonly SimulatorScopeDimension[];
}

export type SimulatorScalarValue =
  | {
      readonly kind: "money";
      readonly amountMinor: number;
      readonly currency: CurrencyCode;
    }
  | {
      readonly kind: "money_rate";
      readonly amountMinor: number;
      readonly currency: CurrencyCode;
      readonly per: "day" | "week" | "month";
    }
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "quantity";
      readonly value: number;
      readonly unit:
        | "units"
        | "hours"
        | "messages"
        | "sessions"
        | "customers"
        | "orders"
        | "days"
        | "seconds";
    }
  | {
      readonly kind: "frequency";
      readonly count: number;
      readonly per: "day" | "week" | "month";
    }
  | {
      readonly kind: "boolean";
      readonly value: boolean;
    }
  | {
      readonly kind: "integer";
      readonly value: number;
    }
  | {
      readonly kind: "string";
      readonly value: string;
    };

export interface SimulatorBaseline {
  readonly value: SimulatorScalarValue;
  readonly referenceKind:
    | "current_at_decision"
    | "baseline_snapshot"
    | "previous_period"
    | "explicit_baseline";
  readonly source: "action_explicit" | "translation_context";
  readonly sourceRef: string;
}

export type SimulatorOperation =
  | {
      readonly kind: "SET";
      readonly value: SimulatorScalarValue;
    }
  | {
      readonly kind: "DELTA";
      readonly direction: "increase" | "decrease";
      readonly amount: SimulatorScalarValue;
      readonly baseline: SimulatorBaseline;
    }
  | {
      readonly kind: "MULTIPLY";
      readonly factor: number;
      readonly baseline: SimulatorBaseline;
    };

export type SimulatorInterventionDuration =
  | { readonly kind: "instantaneous" }
  | { readonly kind: "temporary"; readonly durationSeconds: number }
  | { readonly kind: "persistent" }
  | {
      readonly kind: "recurring";
      readonly recurrence:
        | {
            readonly kind: "daily";
            readonly interval: number;
            readonly maxOccurrences?: number;
          }
        | {
            readonly kind: "weekly";
            readonly interval: number;
            readonly daysOfWeek?: readonly number[];
            readonly maxOccurrences?: number;
          }
        | {
            readonly kind: "monthly";
            readonly interval: number;
            readonly maxOccurrences?: number;
          };
    }
  | { readonly kind: "until_reversed" };

export type SimulatorEndCondition =
  | { readonly kind: "fixed_end"; readonly at: UtcTimestamp }
  | { readonly kind: "fixed_duration"; readonly durationSeconds: number }
  | { readonly kind: "condition"; readonly conditionRef: string }
  | { readonly kind: "manual_reversal" }
  | { readonly kind: "persistent" };

export interface SimulatorInterventionProvenance {
  /** The merchant-level decision. For a coordinated action this is the compound ID. */
  readonly originatingBusinessActionId: string;
  /** The atomic Action whose semantics produced this intervention. */
  readonly sourceActionId: string;
  readonly translationVersion: string;
  readonly translatorId: string;
  readonly componentIndex: number;
  readonly componentCount: number;
  readonly interventionIndexWithinComponent: number;
  readonly interventionCountWithinComponent: number;
}

export interface SimulatorIntervention {
  readonly interventionId: string;
  readonly interventionType: SimulatorInterventionType;
  readonly schemaVersion: SimulatorInterventionSchemaVersion;
  readonly target: SimulatorTarget;
  readonly scope: SimulatorScope;
  readonly operation: SimulatorOperation;
  readonly effectiveTime: UtcTimestamp;
  readonly duration: SimulatorInterventionDuration;
  readonly endCondition: SimulatorEndCondition;
  readonly provenance: SimulatorInterventionProvenance;
}

export type SimulatorInterventionDraft = Omit<
  SimulatorIntervention,
  "interventionId"
>;
