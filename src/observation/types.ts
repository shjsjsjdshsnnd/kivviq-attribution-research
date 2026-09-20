import type {
  CurrencyCode,
  MoneyMinor,
  UtcTimestamp,
} from "../core/units.js";

export type ObservableEventType =
  | "impression"
  | "click"
  | "session_start"
  | "landing_page_view"
  | "collection_view"
  | "product_view"
  | "add_to_cart"
  | "checkout"
  | "purchase";

export interface ObservableEvent {
  readonly eventId: string;
  readonly eventType: ObservableEventType;
  readonly occurredAt: UtcTimestamp;
  readonly subjectCreatedAt: UtcTimestamp;
  readonly anonymousSubjectId: string;
  readonly sessionId?: string;
  readonly channel?: string;
  readonly device?: "mobile" | "desktop" | "tablet";
  readonly productId?: string;
  readonly orderId?: string;
  readonly amountMinor?: MoneyMinor;
  readonly currency?: CurrencyCode;
}

export interface PlatformChannelReport {
  readonly channel: string;
  readonly reportedSpendMinor: MoneyMinor;
  readonly reportedRevenueMinor?: MoneyMinor;
  readonly reportedConversions?: number;
}

export interface MeasurementFlags {
  readonly consentExcluded: boolean;
  readonly identityFragmented: boolean;
  readonly trackingFailure: boolean;
  readonly utmMissing: boolean;
}

export interface MerchantObservation {
  readonly schemaVersion: "1.0.0";
  readonly observationId: string;
  readonly generatedAt: UtcTimestamp;
  readonly events: readonly ObservableEvent[];
  readonly platformReports: readonly PlatformChannelReport[];
  readonly measurementFlags: MeasurementFlags;
}

export interface OperatorInput {
  readonly schemaVersion: "1.0.0";
  readonly observationId: string;
  readonly generatedAt: UtcTimestamp;
  readonly events: readonly ObservableEvent[];
  readonly platformReports: readonly PlatformChannelReport[];
  readonly measurementFlags: MeasurementFlags;
}
