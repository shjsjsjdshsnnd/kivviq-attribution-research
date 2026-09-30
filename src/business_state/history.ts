import type {
  BusinessStateSnapshot,
  CanonicalMetricId,
  DerivedSignalCode,
  MetricState,
} from "./schema.js";
import { metricRegistry } from "./metric-registry.js";

export interface MetricStateChange {
  readonly metricId: CanonicalMetricId;
  readonly from: number | null;
  readonly to: number | null;
  readonly absoluteChange: number | null;
  readonly relativeChange: number | null;
  readonly material: boolean;
  readonly direction:
    | "IMPROVED"
    | "DETERIORATED"
    | "CHANGED"
    | "STABLE"
    | "UNKNOWN";
}

export interface BusinessStateTransition {
  readonly code:
    | "growth_to_slowing"
    | "healthy_margin_to_discount_pressure"
    | "balanced_acquisition_to_retargeting_dependence"
    | "healthy_inventory_to_constrained"
    | "measured_to_low_confidence"
    | "retention_healthy_to_weak";
  readonly active: boolean;
  readonly evidenceMetricIds: readonly CanonicalMetricId[];
  readonly explanation: string;
}

export interface StateChangeSet {
  readonly fromSnapshotId: string;
  readonly toSnapshotId: string;
  readonly metricChanges: readonly MetricStateChange[];
  readonly transitions: readonly BusinessStateTransition[];
}

function stateMap(
  snapshot: BusinessStateSnapshot,
): ReadonlyMap<CanonicalMetricId, MetricState> {
  return new Map(snapshot.metrics.map((metric) => [metric.metricId, metric]));
}

function relativeChange(
  from: number | null,
  to: number | null,
): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to - from) / Math.abs(from);
}

function classifyDirection(
  metricId: CanonicalMetricId,
  from: number | null,
  to: number | null,
  material: boolean,
): MetricStateChange["direction"] {
  if (from === null || to === null) return "UNKNOWN";
  if (!material) return "STABLE";

  const delta = to - from;
  switch (metricRegistry[metricId].direction) {
    case "HIGHER_IS_BETTER":
      return delta > 0 ? "IMPROVED" : "DETERIORATED";
    case "LOWER_IS_BETTER":
      return delta < 0 ? "IMPROVED" : "DETERIORATED";
    case "CONTEXTUAL":
      return "CHANGED";
  }
}

function activeSignal(
  snapshot: BusinessStateSnapshot,
  code: DerivedSignalCode,
): boolean {
  return snapshot.signals.some(
    (signal) => signal.code === code && signal.active,
  );
}

function transition(
  code: BusinessStateTransition["code"],
  active: boolean,
  metricIds: readonly CanonicalMetricId[],
  explanation: string,
): BusinessStateTransition {
  return {
    code,
    active,
    evidenceMetricIds: metricIds,
    explanation,
  };
}

export function detectStateChanges(
  previous: BusinessStateSnapshot,
  current: BusinessStateSnapshot,
): StateChangeSet {
  if (previous.merchantId !== current.merchantId) {
    throw new RangeError("Cannot compare snapshots from different merchants");
  }
  if (Date.parse(previous.asOf) >= Date.parse(current.asOf)) {
    throw new RangeError("Current snapshot must be later than previous snapshot");
  }

  const before = stateMap(previous);
  const after = stateMap(current);
  const ids = new Set<CanonicalMetricId>([
    ...before.keys(),
    ...after.keys(),
  ]);

  const metricChanges: MetricStateChange[] = [];
  for (const metricId of ids) {
    const from = before.get(metricId)?.current ?? null;
    const to = after.get(metricId)?.current ?? null;
    const rel = relativeChange(from, to);
    const threshold =
      metricRegistry[metricId].materialityThresholdPct ?? 0.05;
    const material =
      from !== null &&
      to !== null &&
      (rel === null
        ? Math.abs(to - from) > 0
        : Math.abs(rel) >= threshold);

    metricChanges.push({
      metricId,
      from,
      to,
      absoluteChange:
        from === null || to === null ? null : to - from,
      relativeChange: rel,
      material,
      direction: classifyDirection(metricId, from, to, material),
    });
  }

  const previousRevenue =
    before.get("revenue_net")?.deltaPctVsPrevious ?? null;
  const currentRevenue =
    after.get("revenue_net")?.deltaPctVsPrevious ?? null;

  const transitions: BusinessStateTransition[] = [
    transition(
      "growth_to_slowing",
      previousRevenue !== null &&
        previousRevenue > 0.05 &&
        currentRevenue !== null &&
        currentRevenue <= 0.02,
      ["revenue_net", "orders"],
      "Revenue moved from material period-over-period growth to flat or slowing growth.",
    ),
    transition(
      "healthy_margin_to_discount_pressure",
      !activeSignal(previous, "margin_compression") &&
        !activeSignal(previous, "discount_driven_growth") &&
        (activeSignal(current, "margin_compression") ||
          activeSignal(current, "discount_driven_growth")),
      ["gross_margin", "discount_rate", "revenue_net"],
      "A previously healthier margin state moved into margin compression or discount-driven growth.",
    ),
    transition(
      "balanced_acquisition_to_retargeting_dependence",
      !activeSignal(previous, "retargeting_heavy") &&
        activeSignal(current, "retargeting_heavy"),
      ["retargeting_share", "paid_dependency"],
      "Acquisition moved from a non-retargeting-heavy state to a retargeting-heavy state.",
    ),
    transition(
      "healthy_inventory_to_constrained",
      !activeSignal(previous, "inventory_constrained") &&
        activeSignal(current, "inventory_constrained"),
      ["inventory_days_cover_min", "out_of_stock_rate"],
      "Inventory moved from unconstrained to constrained.",
    ),
    transition(
      "measured_to_low_confidence",
      !activeSignal(previous, "measurement_confidence_low") &&
        activeSignal(current, "measurement_confidence_low"),
      [
        "cogs_coverage",
        "journey_coverage",
        "identity_quality",
        "provider_availability_score",
        "attribution_quality",
        "sample_adequacy",
      ],
      "Measurement quality deteriorated enough to trigger the low-confidence state.",
    ),
    transition(
      "retention_healthy_to_weak",
      !activeSignal(previous, "retention_weak") &&
        activeSignal(current, "retention_weak"),
      ["repeat_rate", "retention_rate_90d"],
      "Customer repeat/retention state moved into the weak range.",
    ),
  ];

  return {
    fromSnapshotId: previous.snapshotId,
    toSnapshotId: current.snapshotId,
    metricChanges,
    transitions,
  };
}

export interface BusinessStateHistoryStore {
  append(snapshot: BusinessStateSnapshot): void;
  latest(merchantId: string): BusinessStateSnapshot | undefined;
  list(merchantId: string): readonly BusinessStateSnapshot[];
  changes(merchantId: string): readonly StateChangeSet[];
}

export class InMemoryBusinessStateHistory
  implements BusinessStateHistoryStore
{
  readonly #snapshots = new Map<string, BusinessStateSnapshot[]>();

  append(snapshot: BusinessStateSnapshot): void {
    const existing = this.#snapshots.get(snapshot.merchantId) ?? [];
    const last = existing.at(-1);
    if (last !== undefined && Date.parse(last.asOf) >= Date.parse(snapshot.asOf)) {
      throw new RangeError(
        "Snapshots must be appended in strictly increasing asOf order",
      );
    }
    existing.push(snapshot);
    this.#snapshots.set(snapshot.merchantId, existing);
  }

  latest(merchantId: string): BusinessStateSnapshot | undefined {
    return this.#snapshots.get(merchantId)?.at(-1);
  }

  list(merchantId: string): readonly BusinessStateSnapshot[] {
    return [...(this.#snapshots.get(merchantId) ?? [])];
  }

  changes(merchantId: string): readonly StateChangeSet[] {
    const snapshots = this.#snapshots.get(merchantId) ?? [];
    const result: StateChangeSet[] = [];
    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1];
      const current = snapshots[index];
      if (previous !== undefined && current !== undefined) {
        result.push(detectStateChanges(previous, current));
      }
    }
    return result;
  }
}
