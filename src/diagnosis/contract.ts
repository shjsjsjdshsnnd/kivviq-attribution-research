/** Step 5 foundation. Draft contract; not a frozen or production interface. */
export const DIAGNOSIS_VERSION = "diagnosis/0.1.0" as const;
export const INPUT_VERSION = "diagnosis-input/0.1.0" as const;

/** Explicit supported subset of the existing canonical business-state metric IDs. */
export const METRIC_IDS = ["revenue_net", "orders", "aov", "sessions", "cvr"] as const;
export type MetricId = typeof METRIC_IDS[number];
export type Source = "SHOPIFY" | "GA4" | "DERIVED" | "GOOGLE_ADS" | "META_ADS" | "PINTEREST_ADS" | "OMNISEND" | "KLAVIYO" | "FIRST_PARTY" | "MERCHANT_CONFIG";
export type Unit = "MONEY" | "COUNT" | "RATIO";
export type ComparisonKind = "PREVIOUS" | "YOY" | "SEASONAL_BASELINE";
export type EvidenceClass = "observed_change" | "associated_driver" | "causal_evidence";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface Window { readonly start: string; readonly end: string }
export interface Observation {
  readonly value: number | null;
  readonly merchantId: string;
  readonly scopeId: string;
  readonly populationId: string;
  /** A versioned metric definition, not a human-readable metric alias. */
  readonly definitionId: string;
  /** Must identify the attribution/tracking/accounting methodology in force. */
  readonly measurementId: string;
  readonly source: Source | null;
  readonly evidenceId: string | null;
  readonly observedAt: string | null;
  readonly dataThrough: string | null;
  readonly coverage: number | null;
  readonly complete: boolean;
  readonly sourceScanComplete: boolean;
  readonly window: Window;
  readonly currency: string | null;
}
export interface MetricSeries {
  readonly metricId: MetricId;
  readonly unit: Unit;
  readonly reference: Observation;
  readonly current: Observation;
}
export interface MaterialityRule {
  readonly absolute: number;
  readonly relative: number;
}
export interface DiagnosisInput {
  readonly version: typeof INPUT_VERSION;
  readonly snapshotId: string;
  readonly merchantId: string;
  readonly asOf: string;
  readonly currency: string;
  /** Explicit scaling; never infer currency exponents from a symbol. */
  readonly minorUnitsPerMajor: 1 | 10 | 100 | 1000;
  readonly comparisonKind: ComparisonKind;
  readonly metrics: readonly MetricSeries[];
  readonly policy: {
    readonly materiality: Readonly<Partial<Record<MetricId, MaterialityRule>>>;
    readonly minimumCoverage: number;
    readonly maxAgeSeconds: number;
    readonly identityToleranceMinorUnits: number;
  };
}
export interface Confidence {
  readonly level: ConfidenceLevel;
  readonly basis: "deterministic_evidence_rubric_not_probability";
  readonly reasons: readonly string[];
  readonly statisticalSignificance: "not_assessed";
}
export interface Change {
  readonly id: string;
  readonly metricId: MetricId;
  readonly unit: Unit;
  readonly status: "material" | "immaterial" | "unknown";
  readonly evidenceClass: "observed_change";
  readonly reference: number | null;
  readonly current: number | null;
  readonly delta: number | null;
  /** delta / abs(reference); null at zero, not an invented infinite growth rate. */
  readonly relativeDelta: number | null;
  readonly reasons: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly confidence: Confidence;
}
export interface Driver {
  readonly id: string;
  readonly metricId: MetricId;
  readonly evidenceClass: "associated_driver";
  readonly interpretation: "arithmetic_allocation_not_causation";
  readonly partitionId: string;
  readonly effectMinorUnits: number;
  /** Can be negative or exceed 1 when effects offset. Null when net delta is zero. */
  readonly signedShareOfNetChange: number | null;
  readonly evidenceIds: readonly string[];
}
export interface RevenueDecomposition {
  readonly status: "explained_arithmetically" | "partial" | "unknown";
  readonly method: "symmetric_product_allocation" | null;
  readonly partitionId: "orders_x_aov" | "sessions_x_cvr_x_aov" | null;
  readonly observedDeltaMinorUnits: number | null;
  readonly allocatedDeltaMinorUnits: number;
  readonly arithmeticResidualMinorUnits: number | null;
  readonly causalExplanation: "not_established";
  /** Aggregate identities do not identify an amount explained causally. */
  readonly causallyExplainedMinorUnits: null;
  readonly drivers: readonly Driver[];
  readonly reasons: readonly string[];
  readonly confidence: Confidence;
}
export interface Unknown {
  readonly id: string;
  readonly whatIsKnown: string;
  readonly whatIsUnknown: string;
  readonly evidenceNeeded: readonly string[];
}
export interface EvidenceNode {
  readonly id: string;
  readonly kind: "source" | "change" | "calculation" | "driver" | "confidence" | "uncertainty";
  readonly label: string;
  readonly metricId?: MetricId;
  readonly evidenceId?: string;
  readonly source?: Source;
  readonly value?: number;
  readonly window?: Window;
  readonly observedAt?: string;
  readonly coverage?: number;
  readonly scopeId?: string;
  readonly populationId?: string;
  readonly definitionId?: string;
  readonly measurementId?: string;
}
export interface EvidenceEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: "supports" | "computed_from" | "qualifies";
}
export interface DiagnosisReport {
  readonly version: typeof DIAGNOSIS_VERSION;
  readonly snapshotId: string;
  readonly merchantId: string;
  readonly asOf: string;
  readonly comparisonKind: ComparisonKind;
  readonly currency: string;
  readonly minorUnitsPerMajor: number;
  readonly status: "diagnosed" | "partial" | "unknown";
  readonly changes: readonly Change[];
  readonly revenue: RevenueDecomposition;
  readonly unknowns: readonly Unknown[];
  readonly evidenceGraph: { readonly nodes: readonly EvidenceNode[]; readonly edges: readonly EvidenceEdge[] };
  readonly explanation: string;
  readonly limitations: readonly string[];
}
