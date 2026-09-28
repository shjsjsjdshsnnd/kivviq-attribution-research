import { describe, expect, it } from "vitest";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
} from "../../src/canonical_action/index.js";
import {
  compoundActionSchema,
  fingerprintCompoundAction,
} from "../../src/compound_action/index.js";
import {
  assessExperimentReadiness,
  experimentReadinessContextSchema,
  fingerprintExperimentReadiness,
  fingerprintExperimentTrafficSource,
} from "../../src/experiment/index.js";
import {
  createPopulationSnapshot,
  evaluatePopulation,
  fingerprintPopulationDefinition,
} from "../../src/population/index.js";

const populationDefinition = {
  schemaVersion: 1 as const,
  populationId: "population_experiment_ready",
  version: 1,
  universe: "ALL_CUSTOMERS" as const,
  inclusion: { kind: "COMPLETED_ORDER_COUNT" as const, operator: "GTE" as const, value: 0 },
  exclusions: [],
  membershipMode: "DYNAMIC_MEMBERSHIP" as const,
  binding: "DECISION_TIME" as const,
  provenance: ["evidence_population"],
};
const populationEvaluation = evaluatePopulation(populationDefinition, {
  evaluatedAt: "2026-09-22T14:00:00.000Z",
  customers: [
    { customerId: "customer_one", completedOrderCount: 1 },
    { customerId: "customer_two", completedOrderCount: 2 },
  ],
});
const population = {
  populationId: populationDefinition.populationId,
  version: 1,
  definitionFingerprint: fingerprintPopulationDefinition(populationDefinition),
  binding: "DECISION_TIME" as const,
  membershipMode: "DYNAMIC_MEMBERSHIP" as const,
};

function noOp(actionId: string) {
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0",
    actionId,
    what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
    timing: fridaySevenDayBudgetTiming,
    provenance: ["evidence_arm"],
  });
}
const control = noOp("action_control");
const treatment = canonicalActionSchema.parse({
  ...noOp("action_treatment"),
  what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PAID_MEDIA" } },
});

function experiment(overrides: Record<string, unknown> = {}) {
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0",
    actionId: "action_experiment_ready",
    population,
    timing: fridaySevenDayBudgetTiming,
    provenance: ["evidence_design"],
    what: {
      actionType: "experiment.run",
      hypothesisRef: "hypothesis_checkout",
      primaryMetricRef: "metric_conversion",
      guardrailMetricRefs: ["metric_margin"],
      randomizationUnit: "CUSTOMER",
      assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" },
      arms: [
        { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
        { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment), allocationBasisPoints: 5000 },
      ],
      stopping: { kind: "FIXED", sampleTarget: 2, timingHorizon: "ENVELOPE_TIMING" },
      measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-10-02T04:00:00Z" },
      ...overrides,
    },
  });
}

function context(overrides: Record<string, unknown> = {}, experimentAction = experiment()) {
  return {
    armRegistry: [
      { entityKind: "ACTION", action: control },
      { entityKind: "ACTION", action: treatment },
    ],
    graphRegistry: [],
    timing: { approvedClock: "2026-09-22T14:00:00.000Z" },
    populations: [populationDefinition],
    evaluations: [populationEvaluation],
    bindingTimes: { DECISION_TIME: "2026-09-22T14:00:00.000Z" },
    metricDefinitions: [
      { metricRef: "metric_conversion", evidenceRefs: ["evidence_metric_conversion"] },
      { metricRef: "metric_margin", evidenceRefs: ["evidence_metric_margin"] },
    ],
    eligibleTraffic: {
      experimentActionFingerprint: fingerprintCanonicalAction(experimentAction),
      populationId: population.populationId,
      version: population.version,
      definitionFingerprint: population.definitionFingerprint,
      binding: population.binding,
      membershipMode: population.membershipMode,
      evaluatedAt: "2026-09-22T14:00:00.000Z",
      rawSourceObservedAt: populationEvaluation.evaluatedAt,
      rawSourceFingerprint: fingerprintExperimentTrafficSource(populationEvaluation),
      maximumAgeSeconds: 3600,
      evidenceRefs: ["evidence_traffic"],
    },
    engineCapability: {
      status: "AVAILABLE",
      randomizationUnits: ["CUSTOMER"],
      evidenceRefs: ["evidence_engine"],
    },
    customRandomizationRegistrations: [],
    ...overrides,
  };
}

describe("experiment readiness", () => {
  it("is READY only when identities, population, timing, metrics, traffic and capability resolve", () => {
    const action = experiment();
    const before = structuredClone(action);
    const result = assessExperimentReadiness(action, context());
    expect(result.status).toBe("READY");
    expect(result.arms.map((arm) => arm.status)).toEqual(["READY", "READY"]);
    expect(result.reasonCodes).toEqual([]);
    expect(result.readinessFingerprint).toBe(fingerprintExperimentReadiness({ ...result, readinessFingerprint: undefined }));
    expect(action).toEqual(before);
  });

  it("binds traffic to the experiment and raw source and applies the stricter freshness limit", () => {
    const action = experiment();
    expect(assessExperimentReadiness(action, context({ eligibleTraffic: {
      ...context().eligibleTraffic, experimentActionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa",
    } }))).toMatchObject({ status: "BLOCKED", reasonCodes: expect.arrayContaining(["ELIGIBLE_TRAFFIC_EXPERIMENT_MISMATCH"]) });
    expect(assessExperimentReadiness(action, context({ eligibleTraffic: {
      ...context().eligibleTraffic, rawSourceFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa",
    } }))).toMatchObject({ status: "BLOCKED", reasonCodes: expect.arrayContaining(["ELIGIBLE_TRAFFIC_SOURCE_MISMATCH"]) });
    expect(assessExperimentReadiness(action, context({ eligibleTraffic: {
      ...context().eligibleTraffic, rawSourceObservedAt: "2026-09-22T12:00:00.000Z", maximumAgeSeconds: 60,
    } }))).toMatchObject({ status: "BLOCKED", reasonCodes: expect.arrayContaining(["STALE_ELIGIBLE_TRAFFIC_SOURCE"]) });
    expect(assessExperimentReadiness(action, context({ eligibleTrafficMaximumAgeSeconds: 30, eligibleTraffic: {
      ...context().eligibleTraffic, rawSourceObservedAt: "2026-09-22T13:59:00.000Z",
    } }))).toMatchObject({ status: "BLOCKED", reasonCodes: expect.arrayContaining(["STALE_ELIGIBLE_TRAFFIC_SOURCE"]) });
  });

  it("reports missing arms as UNKNOWN and fingerprint mismatches as BLOCKED", () => {
    expect(assessExperimentReadiness(experiment(), context({ armRegistry: [{ entityKind: "ACTION", action: control }] })).status).toBe("UNKNOWN");
    expect(assessExperimentReadiness(experiment(), context({ armRegistry: [{ entityKind: "ACTION", action: control }] }))).toMatchObject({
      arms: [{ status: "READY" }, { status: "UNKNOWN", missingRefs: ["action_treatment"] }],
    });
    const wrong = noOp("action_treatment");
    const result = assessExperimentReadiness(experiment(), context({ armRegistry: [
      { entityKind: "ACTION", action: control },
      { entityKind: "ACTION", action: { ...wrong, what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } } } },
    ] }));
    expect(result.status).toBe("BLOCKED");
    expect(result.arms[1]).toMatchObject({ status: "BLOCKED", reasonCodes: ["ARM_FINGERPRINT_MISMATCH"] });
  });

  it("blocks ambiguous duplicate registry identities", () => {
    const result = assessExperimentReadiness(experiment(), context({
      armRegistry: [
        { entityKind: "ACTION", action: control },
        { entityKind: "ACTION", action: treatment },
        { entityKind: "ACTION", action: treatment },
      ],
    }));
    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain("AMBIGUOUS_ARM_REGISTRY");
  });

  it("never selects conflicting duplicate atomic or compound registry entries by order", () => {
    const conflictingTreatment = canonicalActionSchema.parse({
      ...treatment,
      what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } },
    });
    for (const duplicateEntries of [
      [
        { entityKind: "ACTION" as const, action: treatment },
        { entityKind: "ACTION" as const, action: conflictingTreatment },
      ],
      [
        { entityKind: "ACTION" as const, action: conflictingTreatment },
        { entityKind: "ACTION" as const, action: treatment },
      ],
    ]) {
      const result = assessExperimentReadiness(experiment(), context({
        armRegistry: [{ entityKind: "ACTION", action: control }, ...duplicateEntries],
      }));
      expect(result.arms[1]).toMatchObject({
        status: "BLOCKED", reasonCodes: ["AMBIGUOUS_ARM_REGISTRY"], evidenceRefs: [],
      });
    }

    const makeCompound = (support: ReturnType<typeof noOp>) => compoundActionSchema.parse({
      schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_ambiguous",
      components: [
        { componentId: "component_treatment", role: "PRIMARY", action: treatment },
        { componentId: "component_support", role: "SUPPORT", action: support },
      ],
      ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: [],
      atomicity: "ALL_OR_NOTHING", failurePolicy: "STOP_REMAINING", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK",
      constraints: [], populationRelationships: [], measurementHorizon: { amount: 7, unit: "DAY" }, provenance: ["evidence_compound"],
    });
    const compoundA = makeCompound(noOp("action_support_a"));
    const compoundB = makeCompound(noOp("action_support_b"));
    const compoundExperiment = experiment({ arms: [
      { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
      { armId: "arm_treatment", role: "TREATMENT", entityKind: "COMPOUND", compoundActionId: compoundA.compoundActionId, actionFingerprint: fingerprintCompoundAction(compoundA), allocationBasisPoints: 5000 },
    ] });
    for (const compounds of [[compoundA, compoundB], [compoundB, compoundA]]) {
      const result = assessExperimentReadiness(compoundExperiment, context({
        armRegistry: [
          { entityKind: "ACTION", action: control },
          ...compounds.map((action) => ({ entityKind: "COMPOUND" as const, action })),
        ],
      }));
      expect(result.arms[1]).toMatchObject({
        status: "BLOCKED", reasonCodes: ["AMBIGUOUS_ARM_REGISTRY"], evidenceRefs: [],
      });
    }
  });

  it("resolves a compound arm by its compound identity and fingerprint", () => {
    const compound = compoundActionSchema.parse({
      schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_treatment",
      components: [
        { componentId: "component_a", role: "PRIMARY", action: treatment },
        { componentId: "component_b", role: "SUPPORT", action: noOp("action_support") },
      ],
      ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: [],
      atomicity: "ALL_OR_NOTHING", failurePolicy: "STOP_REMAINING", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK",
      constraints: [], populationRelationships: [], measurementHorizon: { amount: 7, unit: "DAY" }, provenance: ["evidence_compound"],
    });
    const action = experiment({ arms: [
      { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
      { armId: "arm_treatment", role: "TREATMENT", entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, actionFingerprint: fingerprintCompoundAction(compound), allocationBasisPoints: 5000 },
    ] });
    const result = assessExperimentReadiness(action, context({ armRegistry: [
      { entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: compound },
    ] }, action));
    expect(result.status).toBe("READY");
    expect(result.arms[1]).toMatchObject({ entityKind: "COMPOUND", status: "READY" });
  });

  it("blocks self references and experiment cycles deterministically", () => {
    const self = experiment({ arms: [
      { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
      { armId: "arm_treatment", role: "TREATMENT", actionId: "action_experiment_ready", actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa", allocationBasisPoints: 5000 },
    ] });
    const result = assessExperimentReadiness(self, context());
    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain("EXPERIMENT_REFERENCE_CYCLE");
  });

  it.each([
    ["population evidence", { populations: [] }, "UNKNOWN", "POPULATION_DEFINITION_REQUIRED"],
    ["population fingerprint mismatch", { populations: [{ ...populationDefinition, provenance: ["evidence_changed"] }] }, "BLOCKED", "POPULATION_DEFINITION_MISMATCH"],
    ["metric", { metricDefinitions: [] }, "UNKNOWN", "METRIC_DEFINITION_REQUIRED"],
    ["traffic identity", { eligibleTraffic: { ...context().eligibleTraffic, definitionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" } }, "BLOCKED", "ELIGIBLE_TRAFFIC_POPULATION_MISMATCH"],
    ["engine", { engineCapability: { status: "UNAVAILABLE", randomizationUnits: [], evidenceRefs: ["evidence_engine"] } }, "BLOCKED", "EXPERIMENT_ENGINE_UNAVAILABLE"],
  ])("gates %s evidence", (_label, override, status, code) => {
    const result = assessExperimentReadiness(experiment(), context(override));
    expect(result.status).toBe(status);
    expect(result.reasonCodes).toContain(code);
  });

  it("requires exact custom randomization registration", () => {
    const action = experiment({ randomizationUnit: { kind: "CUSTOM", registryRef: "registry_units", code: "HOUSEHOLD" } });
    expect(assessExperimentReadiness(action, context({
      engineCapability: { status: "AVAILABLE", randomizationUnits: ["CUSTOM"], evidenceRefs: ["evidence_engine"] },
    }, action)).status).toBe("UNKNOWN");
    expect(assessExperimentReadiness(action, context({
      customRandomizationRegistrations: [{ registryRef: "registry_units", code: "HOUSEHOLD", evidenceRefs: ["evidence_registry"] }],
      engineCapability: { status: "AVAILABLE", randomizationUnits: ["CUSTOM"], evidenceRefs: ["evidence_engine"] },
    }, action)).status).toBe("READY");
  });

  it("blocks duplicate custom randomization registrations independent of order", () => {
    const action = experiment({ randomizationUnit: { kind: "CUSTOM", registryRef: "registry_units", code: "HOUSEHOLD" } });
    const first = { registryRef: "registry_units", code: "HOUSEHOLD", evidenceRefs: ["evidence_registry_a"] };
    const second = { registryRef: "registry_units", code: "HOUSEHOLD", evidenceRefs: ["evidence_registry_b"] };
    for (const registrations of [[first, second], [second, first]]) {
      const result = assessExperimentReadiness(action, context({
        customRandomizationRegistrations: registrations,
        engineCapability: { status: "AVAILABLE", randomizationUnits: ["CUSTOM"], evidenceRefs: ["evidence_engine"] },
      }));
      expect(result.status).toBe("BLOCKED");
      expect(result.reasonCodes).toContain("AMBIGUOUS_CUSTOM_RANDOMIZATION_REGISTRATION");
      expect(result.evidenceRefs).not.toContain("evidence_registry_a");
      expect(result.evidenceRefs).not.toContain("evidence_registry_b");
    }
  });

  it("blocks a measurement window outside the fixed execution horizon", () => {
    const action = experiment({
      measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-10-03T04:00:00Z" },
    });
    expect(assessExperimentReadiness(action, context({}, action))).toMatchObject({
      status: "BLOCKED",
      reasonCodes: ["FIXED_TIMING_HORIZON_TOO_SHORT"],
    });
  });

  it("returns structured INVALID or UNKNOWN results for malformed action or context", () => {
    expect(assessExperimentReadiness({}, context())).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_EXPERIMENT_ACTION"] });
    expect(assessExperimentReadiness(experiment(), { ...context(), unexpected: true })).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_READINESS_CONTEXT"] });
    expect(experimentReadinessContextSchema.safeParse({ ...context(), unexpected: true }).success).toBe(false);
    expect(assessExperimentReadiness(experiment(), context({
      armRegistry: [{
        entityKind: "COMPOUND",
        action: {
          kind: "compound_action", schemaVersion: 1,
          compoundActionId: "compound_bad", components: [
            { componentId: "component_control", role: "CONTROL", action: control },
            { componentId: "component_treatment", role: "TREATMENT", action: treatment },
          ],
          dependencies: [{ kind: "IMPOSSIBLE" }], constraints: [],
          populationRelationships: [], provenance: ["evidence_bad"],
          ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING",
          atomicity: "ALL_OR_NOTHING", failurePolicy: "STOP_REMAINING",
          rollbackPolicy: "NO_AUTOMATIC_ROLLBACK",
          measurementHorizon: { amount: 1, unit: "DAY" },
        },
      }],
    }))).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_READINESS_CONTEXT"] });
  });

  it("derives eligible traffic from exact membership evidence", () => {
    const oneMember = { ...populationEvaluation, members: populationEvaluation.members.slice(0, 1), eligibleCount: 1 };
    expect(assessExperimentReadiness(experiment(), context({ evaluations: [oneMember] }))).toMatchObject({
      status: "BLOCKED", reasonCodes: expect.arrayContaining(["INSUFFICIENT_ELIGIBLE_TRAFFIC"]),
    });
    expect(experimentReadinessContextSchema.safeParse({
      ...context(), eligibleTraffic: { ...context().eligibleTraffic, sampleSize: 9999 },
    }).success).toBe(false);
  });

  it("blocks duplicate exact definitions and evaluations independent of order", () => {
    const duplicateDefinition = structuredClone(populationDefinition);
    const duplicateEvaluation = structuredClone(populationEvaluation);
    for (const populations of [
      [populationDefinition, duplicateDefinition],
      [duplicateDefinition, populationDefinition],
    ])
      expect(assessExperimentReadiness(experiment(), context({ populations }))).toMatchObject({
        status: "BLOCKED",
        reasonCodes: expect.arrayContaining(["AMBIGUOUS_POPULATION_DEFINITION"]),
      });
    for (const evaluations of [
      [populationEvaluation, duplicateEvaluation],
      [duplicateEvaluation, populationEvaluation],
    ])
      expect(assessExperimentReadiness(experiment(), context({ evaluations }))).toMatchObject({
        status: "BLOCKED",
        reasonCodes: expect.arrayContaining(["AMBIGUOUS_POPULATION_EVALUATION"]),
      });
  });

  it("blocks duplicate exact frozen snapshots independent of order", () => {
    const frozenDefinition = { ...populationDefinition, membershipMode: "FROZEN_MEMBERSHIP" as const };
    const frozenEvaluation = evaluatePopulation(frozenDefinition, {
      evaluatedAt: "2026-09-22T14:00:00.000Z",
      customers: [
        { customerId: "customer_one", completedOrderCount: 1 },
        { customerId: "customer_two", completedOrderCount: 2 },
      ],
    });
    const snapshot = createPopulationSnapshot(frozenDefinition, frozenEvaluation, { snapshotId: "snapshot_experiment" });
    const frozenPopulation = {
      populationId: frozenDefinition.populationId,
      version: frozenDefinition.version,
      definitionFingerprint: fingerprintPopulationDefinition(frozenDefinition),
      binding: frozenDefinition.binding,
      membershipMode: frozenDefinition.membershipMode,
      snapshotRef: snapshot.snapshotId,
    };
    const frozenAction = canonicalActionSchema.parse({ ...experiment(), population: frozenPopulation });
    const frozenContext = context({
      populations: [frozenDefinition], evaluations: [frozenEvaluation],
      eligibleTraffic: {
        ...frozenPopulation,
        experimentActionFingerprint: fingerprintCanonicalAction(frozenAction),
        evaluatedAt: snapshot.evaluatedAt,
        rawSourceObservedAt: snapshot.evaluatedAt,
        rawSourceFingerprint: fingerprintExperimentTrafficSource(snapshot),
        maximumAgeSeconds: 3600,
        evidenceRefs: ["evidence_traffic"],
      },
    });
    const clone = structuredClone(snapshot);
    for (const snapshots of [[snapshot, clone], [clone, snapshot]])
      expect(assessExperimentReadiness(frozenAction, { ...frozenContext, snapshots })).toMatchObject({
        status: "BLOCKED",
        reasonCodes: expect.arrayContaining(["AMBIGUOUS_POPULATION_SNAPSHOT"]),
      });
  });

  it("requires UTC-Z readiness timestamps and catches resolver failures", () => {
    expect(assessExperimentReadiness(experiment(), context({
      timing: { approvedClock: "2026-09-22T10:00:00-04:00" },
    }))).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_READINESS_CONTEXT"] });
    expect(assessExperimentReadiness(experiment(), context({
      evaluations: [{ ...populationEvaluation, evaluatedAt: "2026-09-22T10:00:00-04:00" }],
    }))).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_READINESS_CONTEXT"] });
    expect(assessExperimentReadiness(experiment(), context({
      timing: { approvedClock: "2026-09-22T14:00:00.000Z", arbitrary: true },
    }))).toMatchObject({ status: "BLOCKED", reasonCodes: ["INVALID_READINESS_CONTEXT"] });
  });

  it("blocks a measurement window that starts before execution", () => {
    const action = experiment({
      measurementWindow: { start: "2026-09-24T04:00:00Z", end: "2026-10-01T04:00:00Z" },
    });
    expect(assessExperimentReadiness(action, context())).toMatchObject({
      status: "BLOCKED", reasonCodes: expect.arrayContaining(["MEASUREMENT_WINDOW_BEFORE_EXECUTION"]),
    });
  });
});
