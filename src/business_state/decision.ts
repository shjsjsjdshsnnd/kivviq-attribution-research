import type {
  BusinessConstraint,
  BusinessStateSnapshot,
  CanonicalMetricId,
  DerivedSignalCode,
  StateConfidence,
} from "./schema.js";

export interface RequiredStateMetric {
  readonly metricId: CanonicalMetricId;
  readonly minimumConfidence: Exclude<StateConfidence, "UNKNOWN">;
}

export interface ExpectedStateConsequence {
  readonly metricId: CanonicalMetricId;
  readonly expectedDirection:
    | "INCREASE"
    | "DECREASE"
    | "NO_CHANGE"
    | "UNKNOWN";
  readonly expectedDelta?: number;
  readonly lowerBound?: number;
  readonly upperBound?: number;
  readonly horizonDays: number;
  readonly confidence: StateConfidence;
  readonly measurementMethod: string;
}

export interface BusinessActionCandidate {
  readonly actionId: string;
  readonly description: string;
  readonly simulatorInterventionRef: string;
  readonly requiredMetrics: readonly RequiredStateMetric[];
  readonly requiredConstraintIds: readonly string[];
  readonly forbiddenSignals?: readonly DerivedSignalCode[];
  readonly requiredSignals?: readonly DerivedSignalCode[];
  readonly expectedConsequences: readonly ExpectedStateConsequence[];
}

export interface ActionCompatibility {
  readonly actionId: string;
  readonly status: "ELIGIBLE" | "BLOCKED" | "ABSTAIN";
  readonly reasons: readonly string[];
  readonly evidenceMetricIds: readonly CanonicalMetricId[];
  readonly constraintIds: readonly string[];
}

export interface DecisionIntelligenceContext {
  readonly snapshotId: string;
  readonly merchantId: string;
  readonly asOf: string;
  readonly eligible: readonly BusinessActionCandidate[];
  readonly blocked: readonly BusinessActionCandidate[];
  readonly abstained: readonly BusinessActionCandidate[];
  readonly assessments: readonly ActionCompatibility[];
  readonly automaticDecisionAllowed: false;
}

const confidenceRank: Record<StateConfidence, number> = {
  UNKNOWN: 0,
  UNCERTAIN: 1,
  PARTIAL: 2,
  KNOWN: 3,
};

function signalActive(
  snapshot: BusinessStateSnapshot,
  code: DerivedSignalCode,
): boolean {
  return snapshot.signals.some(
    (signal) => signal.code === code && signal.active,
  );
}

function constraintById(
  snapshot: BusinessStateSnapshot,
  constraintId: string,
): BusinessConstraint | undefined {
  return snapshot.constraints.find(
    (constraint) => constraint.constraintId === constraintId,
  );
}

export function assessActionCompatibility(
  snapshot: BusinessStateSnapshot,
  action: BusinessActionCandidate,
): ActionCompatibility {
  const reasons: string[] = [];
  const evidenceMetricIds = new Set<CanonicalMetricId>();
  const constraintIds = new Set<string>();
  let blocked = false;
  let abstain = false;

  for (const required of action.requiredMetrics) {
    evidenceMetricIds.add(required.metricId);
    const metric = snapshot.metrics.find(
      (item) => item.metricId === required.metricId,
    );
    if (metric === undefined || metric.current === null) {
      reasons.push("MISSING_REQUIRED_METRIC:" + required.metricId);
      abstain = true;
      continue;
    }
    if (
      confidenceRank[metric.confidence] <
      confidenceRank[required.minimumConfidence]
    ) {
      reasons.push(
        "INSUFFICIENT_METRIC_CONFIDENCE:" +
          required.metricId +
          ":" +
          metric.confidence,
      );
      abstain = true;
    }
  }

  for (const constraintId of action.requiredConstraintIds) {
    constraintIds.add(constraintId);
    const constraint = constraintById(snapshot, constraintId);
    if (constraint === undefined) {
      reasons.push("MISSING_CONSTRAINT:" + constraintId);
      abstain = true;
      continue;
    }
    for (const metricId of constraint.evidenceMetricIds) {
      evidenceMetricIds.add(metricId);
    }
    if (constraint.status === "VIOLATED") {
      reasons.push("CONSTRAINT_VIOLATED:" + constraintId);
      blocked = true;
    } else if (constraint.status === "UNKNOWN") {
      reasons.push("CONSTRAINT_UNKNOWN:" + constraintId);
      abstain = true;
    }
  }

  for (const code of action.forbiddenSignals ?? []) {
    const stateSignal = snapshot.signals.find(
      (signal) => signal.code === code && signal.active,
    );
    if (stateSignal !== undefined) {
      reasons.push("FORBIDDEN_STATE_SIGNAL:" + code);
      for (const metricId of stateSignal.evidenceMetricIds) {
        evidenceMetricIds.add(metricId);
      }
      blocked = true;
    }
  }

  for (const code of action.requiredSignals ?? []) {
    const stateSignal = snapshot.signals.find(
      (signal) => signal.code === code,
    );
    if (stateSignal === undefined || stateSignal.confidence === "UNKNOWN") {
      reasons.push("REQUIRED_SIGNAL_UNKNOWN:" + code);
      abstain = true;
    } else if (!stateSignal.active) {
      reasons.push("REQUIRED_SIGNAL_ABSENT:" + code);
      blocked = true;
    }
    if (stateSignal !== undefined) {
      for (const metricId of stateSignal.evidenceMetricIds) {
        evidenceMetricIds.add(metricId);
      }
    }
  }

  const status: ActionCompatibility["status"] = blocked
    ? "BLOCKED"
    : abstain
      ? "ABSTAIN"
      : "ELIGIBLE";

  return {
    actionId: action.actionId,
    status,
    reasons,
    evidenceMetricIds: [...evidenceMetricIds].sort(),
    constraintIds: [...constraintIds].sort(),
  };
}

export function buildDecisionIntelligenceContext(
  snapshot: BusinessStateSnapshot,
  actions: readonly BusinessActionCandidate[],
): DecisionIntelligenceContext {
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.actionId)) {
      throw new RangeError("Duplicate action candidate: " + action.actionId);
    }
    seen.add(action.actionId);
    if (action.expectedConsequences.length === 0) {
      throw new RangeError(
        "Action must define measurable expected consequences: " +
          action.actionId,
      );
    }
    for (const consequence of action.expectedConsequences) {
      if (!Number.isInteger(consequence.horizonDays) || consequence.horizonDays <= 0) {
        throw new RangeError(
          "Action consequence must have a positive integer measurement horizon",
        );
      }
    }
  }

  const assessments = actions.map((action) =>
    assessActionCompatibility(snapshot, action),
  );
  const byStatus = new Map(
    assessments.map((assessment) => [
      assessment.actionId,
      assessment.status,
    ]),
  );

  return {
    snapshotId: snapshot.snapshotId,
    merchantId: snapshot.merchantId,
    asOf: snapshot.asOf,
    eligible: actions.filter(
      (action) => byStatus.get(action.actionId) === "ELIGIBLE",
    ),
    blocked: actions.filter(
      (action) => byStatus.get(action.actionId) === "BLOCKED",
    ),
    abstained: actions.filter(
      (action) => byStatus.get(action.actionId) === "ABSTAIN",
    ),
    assessments,
    automaticDecisionAllowed: false,
  };
}

export interface AbstentionResult {
  readonly mustAbstain: boolean;
  readonly reasons: readonly string[];
  readonly evidenceNeeded: readonly CanonicalMetricId[];
}

export function assessDecisionAbstention(
  snapshot: BusinessStateSnapshot,
  action: BusinessActionCandidate,
): AbstentionResult {
  const assessment = assessActionCompatibility(snapshot, action);
  const needed = new Set<CanonicalMetricId>();
  for (const required of action.requiredMetrics) {
    const metric = snapshot.metrics.find(
      (item) => item.metricId === required.metricId,
    );
    if (
      metric === undefined ||
      metric.current === null ||
      confidenceRank[metric.confidence] <
        confidenceRank[required.minimumConfidence]
    ) {
      needed.add(required.metricId);
    }
  }

  for (const constraintId of action.requiredConstraintIds) {
    const constraint = constraintById(snapshot, constraintId);
    if (constraint === undefined || constraint.status === "UNKNOWN") {
      for (const metricId of constraint?.evidenceMetricIds ?? []) {
        needed.add(metricId);
      }
    }
  }

  return {
    mustAbstain: assessment.status === "ABSTAIN",
    reasons: assessment.reasons,
    evidenceNeeded: [...needed].sort(),
  };
}

export interface SimulatorBusinessStateSeed {
  readonly version: "business-state-simulator-seed/1.0.0";
  readonly sourceSnapshotId: string;
  readonly merchantId: string;
  readonly asOf: string;
  readonly currency: string;
  readonly timezone: string;
  readonly knownMetrics: Readonly<Record<string, number>>;
  readonly unknownMetricIds: readonly CanonicalMetricId[];
  readonly activeSignals: readonly DerivedSignalCode[];
  readonly constraints: readonly {
    constraintId: string;
    status: BusinessConstraint["status"];
    metricId?: CanonicalMetricId;
    observedValue?: number | null;
  }[];
}

export function snapshotToSimulatorSeed(
  snapshot: BusinessStateSnapshot,
): SimulatorBusinessStateSeed {
  const knownMetrics: Record<string, number> = {};
  const unknownMetricIds: CanonicalMetricId[] = [];

  for (const metric of [...snapshot.metrics].sort((a, b) =>
    a.metricId.localeCompare(b.metricId),
  )) {
    if (metric.current === null || metric.confidence === "UNKNOWN") {
      unknownMetricIds.push(metric.metricId);
    } else {
      knownMetrics[metric.metricId] = metric.current;
    }
  }

  return {
    version: "business-state-simulator-seed/1.0.0",
    sourceSnapshotId: snapshot.snapshotId,
    merchantId: snapshot.merchantId,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    timezone: snapshot.timezone,
    knownMetrics,
    unknownMetricIds: unknownMetricIds.sort(),
    activeSignals: snapshot.signals
      .filter((signal) => signal.active)
      .map((signal) => signal.code)
      .sort(),
    constraints: [...snapshot.constraints]
      .sort((a, b) => a.constraintId.localeCompare(b.constraintId))
      .map((constraint) => ({
        constraintId: constraint.constraintId,
        status: constraint.status,
        ...(constraint.metricId === undefined
          ? {}
          : { metricId: constraint.metricId }),
        ...(constraint.observedValue === undefined
          ? {}
          : { observedValue: constraint.observedValue }),
      })),
  };
}

export function deterministicSimulatorSeedJson(
  snapshot: BusinessStateSnapshot,
): string {
  return JSON.stringify(snapshotToSimulatorSeed(snapshot));
}

export function assertDecisionCompatibility(
  context: DecisionIntelligenceContext,
): void {
  const blockedIds = new Set(context.blocked.map((action) => action.actionId));
  const abstainedIds = new Set(
    context.abstained.map((action) => action.actionId),
  );
  for (const action of context.eligible) {
    if (
      blockedIds.has(action.actionId) ||
      abstainedIds.has(action.actionId)
    ) {
      throw new Error(
        "Action appears in incompatible decision-context buckets: " +
          action.actionId,
      );
    }
  }
}
