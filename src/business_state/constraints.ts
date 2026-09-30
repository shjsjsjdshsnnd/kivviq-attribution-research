import {
  businessStateSnapshotSchema,
  type BusinessConstraint,
  type BusinessStateSnapshot,
  type CanonicalMetricId,
  type ConstraintKind,
  type MetricUnit,
} from "./schema.js";
import { metricRegistry } from "./metric-registry.js";

export interface BusinessConstraintDefinition {
  readonly constraintId: string;
  readonly kind: ConstraintKind;
  readonly metricId: CanonicalMetricId;
  readonly comparator: "LTE" | "GTE" | "EQ";
  readonly threshold: number;
  readonly unit: MetricUnit;
  readonly reason: string;
}

function compare(
  value: number,
  comparator: BusinessConstraintDefinition["comparator"],
  threshold: number,
): boolean {
  switch (comparator) {
    case "LTE":
      return value <= threshold;
    case "GTE":
      return value >= threshold;
    case "EQ":
      return value === threshold;
  }
}

export function evaluateBusinessConstraint(
  snapshot: BusinessStateSnapshot,
  definition: BusinessConstraintDefinition,
): BusinessConstraint {
  if (metricRegistry[definition.metricId].unit !== definition.unit) {
    throw new RangeError(
      "Constraint unit does not match metric unit for " +
        definition.metricId,
    );
  }

  const metric = snapshot.metrics.find(
    (item) => item.metricId === definition.metricId,
  );
  const value = metric?.current ?? null;
  const evidenceIds =
    metric?.evidence.map((evidence) => evidence.evidenceId) ?? [];

  if (
    metric === undefined ||
    value === null ||
    metric.confidence === "UNKNOWN" ||
    metric.confidence === "UNCERTAIN"
  ) {
    return {
      constraintId: definition.constraintId,
      kind: definition.kind,
      status: "UNKNOWN",
      metricId: definition.metricId,
      comparator: definition.comparator,
      threshold: definition.threshold,
      observedValue: value,
      unit: definition.unit,
      evidenceMetricIds: [definition.metricId],
      reason:
        "Constraint cannot be established because its metric is missing or insufficiently measured: " +
        definition.reason,
    };
  }

  return {
    constraintId: definition.constraintId,
    kind: definition.kind,
    status: compare(value, definition.comparator, definition.threshold)
      ? "SATISFIED"
      : "VIOLATED",
    metricId: definition.metricId,
    comparator: definition.comparator,
    threshold: definition.threshold,
    observedValue: value,
    unit: definition.unit,
    evidenceMetricIds: [definition.metricId],
    reason: definition.reason + "; evidence=" + evidenceIds.join(","),
  };
}

export function evaluateBusinessConstraints(
  snapshot: BusinessStateSnapshot,
  definitions: readonly BusinessConstraintDefinition[],
): BusinessConstraint[] {
  const seen = new Set<string>();
  return definitions.map((definition) => {
    if (seen.has(definition.constraintId)) {
      throw new RangeError(
        "Duplicate business constraint: " + definition.constraintId,
      );
    }
    seen.add(definition.constraintId);
    return evaluateBusinessConstraint(snapshot, definition);
  });
}

export function withBusinessConstraints(
  snapshot: BusinessStateSnapshot,
  definitions: readonly BusinessConstraintDefinition[],
): BusinessStateSnapshot {
  return businessStateSnapshotSchema.parse({
    ...snapshot,
    constraints: evaluateBusinessConstraints(snapshot, definitions),
  });
}

export function defaultBusinessConstraintDefinitions(
  snapshot: BusinessStateSnapshot,
): readonly BusinessConstraintDefinition[] {
  const definitions: BusinessConstraintDefinition[] = [
    {
      constraintId: "measurement:cogs-coverage",
      kind: "MEASUREMENT_MINIMUM",
      metricId: "cogs_coverage",
      comparator: "GTE",
      threshold: 0.95,
      unit: "RATIO",
      reason:
        "Profit decisions require at least 95% COGS coverage by governed merchandise value.",
    },
    {
      constraintId: "measurement:journey-coverage",
      kind: "MEASUREMENT_MINIMUM",
      metricId: "journey_coverage",
      comparator: "GTE",
      threshold: 0.7,
      unit: "RATIO",
      reason:
        "Journey-dependent decisions require at least 70% eligible order linkage.",
    },
    {
      constraintId: "measurement:sample-adequacy",
      kind: "SAMPLE_MINIMUM",
      metricId: "sample_adequacy",
      comparator: "GTE",
      threshold: 0.7,
      unit: "RATIO",
      reason:
        "Decision evidence requires a governed sample-adequacy score of at least 0.70.",
    },
    {
      constraintId: "inventory:minimum-cover",
      kind: "INVENTORY_LIMIT",
      metricId: "inventory_days_cover_min",
      comparator: "GTE",
      threshold: 7,
      unit: "DAYS",
      reason:
        "Scaling actions are constrained when a material product has less than seven days of stock cover.",
    },
  ];

  if (
    snapshot.metrics.some(
      (metric) => metric.metricId === "gross_margin",
    )
  ) {
    definitions.push({
      constraintId: "margin:non-negative",
      kind: "MARGIN_FLOOR",
      metricId: "gross_margin",
      comparator: "GTE",
      threshold: 0,
      unit: "RATIO",
      reason:
        "The observed gross margin must not be negative.",
    });
  }

  return definitions;
}
