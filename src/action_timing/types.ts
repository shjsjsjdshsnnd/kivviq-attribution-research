import type { UtcTimestamp } from "../core/units.js";

export const ACTION_TIMING_SCHEMA_VERSION = "1.0.0" as const;
export type ActionTimingSchemaVersion = typeof ACTION_TIMING_SCHEMA_VERSION;

export type TimingValue<T> =
  | {
      readonly state: "SPECIFIED";
      readonly value: T;
      readonly sourceRef?: string;
    }
  | { readonly state: "UNKNOWN"; readonly reason: string }
  | { readonly state: "ABSENT"; readonly reason?: string }
  | { readonly state: "NOT_APPLICABLE"; readonly reason: string };

export type DurationAnchor =
  "DECISION_TIME" | "REQUESTED_START" | "EFFECTIVE_START";

export type ElapsedUnit = "SECOND" | "MINUTE" | "HOUR";
export type CalendarUnit = "DAY" | "WEEK" | "MONTH";

export type TemporalOffset =
  | {
      readonly kind: "ELAPSED";
      readonly amount: number;
      readonly unit: ElapsedUnit;
    }
  | {
      readonly kind: "CALENDAR";
      readonly amount: number;
      readonly unit: CalendarUnit;
    };

export interface ZonedBusinessTime {
  readonly localDateTime: string;
  readonly timeZone: string;
}

export type AbsoluteTime =
  | {
      readonly kind: "UTC";
      readonly at: UtcTimestamp;
      readonly timeZone: string;
    }
  | { readonly kind: "LOCAL"; readonly at: ZonedBusinessTime };

export type RequestedStart =
  | { readonly kind: "IMMEDIATE" }
  | { readonly kind: "ABSOLUTE"; readonly time: AbsoluteTime }
  | {
      readonly kind: "EVENT_RELATIVE";
      readonly relation: "AFTER_EVENT" | "BEFORE_EVENT";
      readonly eventId: string;
      readonly offset: TemporalOffset;
    }
  | {
      readonly kind: "TRIGGER_RELATIVE";
      readonly triggerId: string;
    }
  | {
      readonly kind: "ACTION_RELATIVE";
      readonly relation:
        | "START_AFTER_ACTION_EFFECTIVE"
        | "START_AFTER_ACTION_COMPLETED"
        | "END_WHEN_ACTION_STARTS";
      readonly actionId: string;
      readonly offset?: TemporalOffset;
    };

export type EffectiveStart =
  | { readonly kind: "DERIVE_FROM_REQUESTED_START" }
  | { readonly kind: "ABSOLUTE"; readonly time: AbsoluteTime }
  | {
      readonly kind: "EVENT_RELATIVE";
      readonly relation: "AFTER_EVENT" | "BEFORE_EVENT";
      readonly eventId: string;
      readonly offset: TemporalOffset;
    }
  | {
      readonly kind: "ACTION_RELATIVE";
      readonly relation:
        "START_AFTER_ACTION_EFFECTIVE" | "START_AFTER_ACTION_COMPLETED";
      readonly actionId: string;
      readonly offset?: TemporalOffset;
    };

export type TimingDuration =
  | { readonly kind: "INSTANTANEOUS" }
  | {
      readonly kind: "ELAPSED";
      readonly amount: number;
      readonly unit: ElapsedUnit;
      readonly anchor: DurationAnchor;
    }
  | {
      readonly kind: "CALENDAR";
      readonly amount: number;
      readonly unit: CalendarUnit;
      readonly anchor: DurationAnchor;
    }
  | { readonly kind: "PERSISTENT" };

export type EndRule =
  | { readonly kind: "ABSOLUTE"; readonly time: AbsoluteTime }
  | { readonly kind: "DERIVE_FROM_DURATION" };

export type BusinessStateCondition =
  | {
      readonly kind: "METRIC_THRESHOLD";
      readonly metricId: string;
      readonly operator: "LT" | "LTE" | "EQ" | "GTE" | "GT";
      readonly value: number;
      readonly unit?: string;
    }
  | { readonly kind: "EVENT_OCCURS"; readonly eventId: string }
  | { readonly kind: "ACTION_STARTS"; readonly actionId: string }
  | { readonly kind: "ACTION_COMPLETES"; readonly actionId: string };

export type TerminationCondition =
  | { readonly kind: "STATE"; readonly condition: BusinessStateCondition }
  | {
      readonly kind: "COMPOSITE";
      readonly operator: "FIRST_OF" | "LAST_OF" | "ALL_REQUIRED";
      readonly conditions: readonly TerminationCondition[];
    };

export type RecurrenceFrequency =
  | {
      readonly kind: "DAILY";
      readonly interval: number;
      readonly localTime?: string;
    }
  | {
      readonly kind: "WEEKLY";
      readonly interval: number;
      readonly daysOfWeek: readonly number[];
      readonly localTime: string;
    }
  | {
      readonly kind: "MONTHLY";
      readonly interval: number;
      readonly dayOfMonth: number;
      readonly localTime: string;
    }
  | {
      readonly kind: "CUSTOM_INTERVAL";
      readonly every: TemporalOffset;
    };

export type RecurrenceBoundary =
  | {
      readonly kind: "BOUNDED";
      readonly recurrenceStart?: AbsoluteTime;
      readonly recurrenceEnd?: AbsoluteTime;
      readonly maxOccurrences?: number;
    }
  | { readonly kind: "OPEN_ENDED"; readonly explicitlyOpenEnded: true };

export interface TimingRecurrence {
  readonly frequency: RecurrenceFrequency;
  readonly boundary: RecurrenceBoundary;
}

export interface TimingConstraints {
  readonly earliestStart?: AbsoluteTime;
  readonly latestStart?: AbsoluteTime;
  readonly minimumDuration?: TimingDuration;
  readonly maximumDuration?: TimingDuration;
}

export type TimingDependency =
  | {
      readonly kind:
        "START_AFTER" | "EFFECTIVE_AFTER" | "COMPLETE_AFTER" | "END_WITH";
      readonly actionId: string;
      readonly offset?: TemporalOffset;
    }
  | {
      readonly kind: "START_AFTER_ACTION_EFFECTIVE";
      readonly actionId: string;
      readonly offset?: TemporalOffset;
    }
  | {
      readonly kind: "START_AFTER_ACTION_COMPLETED";
      readonly actionId: string;
      readonly offset?: TemporalOffset;
    }
  | {
      readonly kind: "END_WHEN_ACTION_STARTS";
      readonly actionId: string;
    };

export interface ActionTiming {
  readonly schemaVersion: ActionTimingSchemaVersion;
  readonly decisionTime: TimingValue<UtcTimestamp>;
  readonly requestedStart: TimingValue<RequestedStart>;
  readonly implementationDelay: TimingValue<TemporalOffset>;
  readonly effectiveStart: TimingValue<EffectiveStart>;
  readonly duration: TimingValue<TimingDuration>;
  readonly end: TimingValue<EndRule>;
  readonly terminationCondition: TimingValue<TerminationCondition>;
  readonly recurrence: TimingValue<TimingRecurrence>;
  readonly timezone: TimingValue<string>;
  readonly constraints: TimingValue<TimingConstraints>;
  readonly dependencies: readonly TimingDependency[];
}

export type TimingValidationStatus = "VALID" | "INVALID" | "UNRESOLVED";

export interface ResolvedOccurrence {
  readonly occurrenceIndex: number;
  readonly actionId?: string;
  readonly effectiveStart: UtcTimestamp;
  readonly end?: UtcTimestamp;
}

export interface TimingResolution {
  readonly timingSchemaVersion: ActionTimingSchemaVersion;
  readonly status: TimingValidationStatus;
  readonly resolvedRequestedStart?: UtcTimestamp;
  readonly resolvedEffectiveStart?: UtcTimestamp;
  readonly resolvedEnd?: UtcTimestamp;
  readonly occurrences: readonly ResolvedOccurrence[];
  readonly unresolvedDependencies: readonly string[];
  readonly missingContext: readonly string[];
  readonly validationCodes: readonly string[];
  readonly provenance: readonly string[];
}

export interface ActionTimingResolutionContext {
  readonly approvedClock: UtcTimestamp;
  readonly actionId?: string;
  readonly dependencyGraph?: readonly {
    readonly actionId: string;
    readonly dependencies: readonly TimingDependency[];
    readonly timing?: ActionTiming;
  }[];
  readonly maxOccurrences?: number;
  readonly horizonEnd?: UtcTimestamp;
  readonly disambiguation?: "reject" | "earlier" | "later";
  readonly metricObservations?: Readonly<
    Record<
      string,
      {
        readonly value: number;
        readonly observedAt: UtcTimestamp;
        readonly unit?: string;
      }
    >
  >;
  readonly eventTimes?: Readonly<Record<string, UtcTimestamp>>;
  readonly triggerTimes?: Readonly<Record<string, UtcTimestamp>>;
  readonly actionTimes?: Readonly<
    Record<
      string,
      {
        readonly effectiveStart?: UtcTimestamp;
        readonly completedAt?: UtcTimestamp;
        readonly requestedStart?: UtcTimestamp;
        readonly end?: UtcTimestamp;
      }
    >
  >;
}
