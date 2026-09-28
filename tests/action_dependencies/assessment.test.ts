import { describe, expect, it } from "vitest";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { canonicalActionSchema, fingerprintCanonicalAction } from "../../src/canonical_action/index.js";
import { assessActionDependencies, fingerprintDependencyAssessment } from "../../src/action_dependencies/index.js";
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { evaluateEligibilityForTest } from "../action_translation/eligibility-helper.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../../src/compound_action/index.js";
import { evaluatePopulation, fingerprintPopulationDefinition } from "../../src/population/index.js";
import { fingerprintExperimentTrafficSource } from "../../src/experiment/index.js";

const NOW = "2026-09-22T14:00:00.000Z";
const prerequisite = canonicalActionSchema.parse({
  schemaVersion: "2.0.0", actionId: "action_inventory_purchase",
  what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
  timing: fridaySevenDayBudgetTiming, provenance: ["inventory.plan"],
});

function dependent(requiredState: "STARTED" | "EFFECTIVE" | "COMPLETED" | "RESOLVED" = "COMPLETED") {
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0", actionId: "action_scale_product_a_ads",
    what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PAID_MEDIA" } },
    timing: fridaySevenDayBudgetTiming, provenance: ["ads.plan"],
    dependencies: [{ dependencyId: "inventory_ready", kind: "ENTITY_LIFECYCLE", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED",
      prerequisite: { entityKind: "ACTION", actionId: prerequisite.actionId, actionFingerprint: fingerprintCanonicalAction(prerequisite) }, requiredState }],
  });
}

function event(kind: "STARTED" | "EFFECTIVE" | "COMPLETED" = "COMPLETED") {
  return { eventId: `event_${kind.toLowerCase()}`, subject: { kind: "ACTION" as const, actionId: prerequisite.actionId,
    actionFingerprint: fingerprintCanonicalAction(prerequisite) }, eventKind: kind, occurredAt: NOW,
    sourceRef: "execution.ledger", provenance: ["execution.event"] };
}

function context(events = [event()], action = dependent()) {
  const dependency = action.dependencies[0]!;
  const fact = dependency.kind === "ENTITY_LIFECYCLE"
    ? dependency.requiredState === "RESOLVED"
      ? { kind: "INVESTIGATION_RESULT_INPUT" as const, prerequisite: dependency.prerequisite }
      : { kind: "ENTITY_LIFECYCLE" as const, prerequisite: dependency.prerequisite, events }
    : dependency.kind === "ELIGIBILITY_CHECK_GATE"
      ? { kind: "ELIGIBILITY_INPUT" as const, checkId: dependency.checkId }
      : dependency.kind === "HARD_CONSTRAINT_GATE"
        ? { kind: "CONSTRAINT_INPUT" as const, constraintId: dependency.constraintId }
        : { kind: "EXPERIMENT_READINESS_INPUT" as const, requirement: dependency.requirement };
  return { evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME" as const, maximumAgeSeconds: 3600,
    registry: [{ entityKind: "ACTION" as const, action: prerequisite }], dependencyReceipts: events.length || dependency.kind !== "ENTITY_LIFECYCLE" || dependency.requiredState === "RESOLVED" ? [{
      receiptId: "dependency.receipt", dependentActionId: action.actionId, dependentActionFingerprint: fingerprintCanonicalAction(action),
      dependencyId: dependency.dependencyId, evaluationBoundary: dependency.evaluationBoundary, observedAt: NOW,
      evidenceRefs: ["dependency.evidence"], provenance: ["dependency.provenance"], fact,
    }] : [],
    investigationResults: [], constraintReceipts: [], eligibilityContexts: {}, eligibilityResourceRequirements: {},
    experimentReadinessContexts: {} };
}

describe("action dependency assessment", () => {
  it("derives lifecycle state only from an exact raw event and fingerprints the sorted report", () => {
    const action = dependent();
    const report = assessActionDependencies(action, context());
    expect(report.status).toBe("SATISFIED");
    expect(report.checks).toMatchObject([{ dependencyId: "inventory_ready", status: "SATISFIED", reasonCodes: ["REQUIRED_LIFECYCLE_STATE_OBSERVED"] }]);
    expect(report.assessmentFingerprint).toBe(fingerprintDependencyAssessment({ ...report, assessmentFingerprint: undefined }));
  });

  it("fails closed for missing, mismatched, duplicate, future, and stale lifecycle evidence", () => {
    const action = dependent();
    expect(assessActionDependencies(action, context([])).status).toBe("BLOCKED");
    expect(assessActionDependencies(action, context([{ ...event(), subject: { ...event().subject, actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" } }])).status).toBe("BLOCKED");
    for (const events of [[event(), { ...event(), eventId: "event_second" }], [{ ...event(), eventId: "event_second" }, event()]])
      expect(assessActionDependencies(action, context(events)).checks[0]).toMatchObject({ status: "UNKNOWN", reasonCodes: ["AMBIGUOUS_LIFECYCLE_EVIDENCE"] });
    expect(assessActionDependencies(action, context([{ ...event(), occurredAt: "2026-09-22T15:00:00.000Z" }])).status).toBe("BLOCKED");
    expect(assessActionDependencies(action, context([{ ...event(), occurredAt: "2026-09-22T12:00:00.000Z" }])).status).toBe("BLOCKED");
  });

  it("accepts monotonic lifecycle history without treating later states as ambiguity", () => {
    const action = dependent("STARTED");
    const report = assessActionDependencies(action, context([event("STARTED"), event("EFFECTIVE"), event("COMPLETED")], action));
    expect(report.status).toBe("SATISFIED");
  });

  it("requires one fresh receipt bound to dependent identity, dependency, and boundary", () => {
    const action = dependent();
    const receipt = context().dependencyReceipts[0] as Record<string, unknown>;
    for (const mutation of [
      { dependentActionId: "action_other" }, { dependentActionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" },
      { dependencyId: "other_dependency" }, { evaluationBoundary: "DECISION_TIME" },
    ]) expect(assessActionDependencies(action, { ...context(), dependencyReceipts: [{ ...receipt, ...mutation }] }).status).toBe("BLOCKED");
    for (const dependencyReceipts of [
      [receipt, { ...receipt, receiptId: "dependency.receipt.second" }],
      [{ ...receipt, receiptId: "dependency.receipt.second" }, receipt],
    ]) expect(assessActionDependencies(action, { ...context(), dependencyReceipts }).checks[0]).toMatchObject({
      status: "UNKNOWN", reasonCodes: ["AMBIGUOUS_BOUND_DEPENDENCY_RECEIPT"],
    });
    expect(assessActionDependencies(action, { ...context(), dependencyReceipts: [{ ...receipt, observedAt: "2026-09-22T15:00:00.000Z" }] }).status).toBe("BLOCKED");
    expect(assessActionDependencies(action, { ...context(), maximumAgeSeconds: 60, dependencyReceipts: [{ ...receipt, observedAt: "2026-09-22T12:00:00.000Z" }] }).status).toBe("BLOCKED");
  });

  it("returns a blocked report instead of throwing for malformed public input or context", () => {
    expect(() => assessActionDependencies({}, {})).not.toThrow();
    expect(assessActionDependencies({}, {})).toMatchObject({ status: "BLOCKED" });
    expect(assessActionDependencies(dependent(), { ...context(), maximumAgeSeconds: Number.POSITIVE_INFINITY })).toMatchObject({ status: "BLOCKED" });
    expect(assessActionDependencies(dependent(), { ...context(), registry: [{ entityKind: "ACTION", action: { actionId: prerequisite.actionId } }] })).toMatchObject({ status: "BLOCKED" });
    for (const malformed of [null, 1, "registry"])
      expect(() => assessActionDependencies(dependent(), { ...context(), registry: [malformed] })).not.toThrow();
    const first = assessActionDependencies(dependent(), {}), second = assessActionDependencies(dependent(), { unexpected: true });
    expect(first).toMatchObject({ evaluatedAt: "1970-01-01T00:00:00.000Z", evaluationBoundary: "DECISION_TIME", status: "BLOCKED" });
    expect(second.assessmentFingerprint).toBe(first.assessmentFingerprint);
  });

  it("replays Product A inventory availability with exact resource requirements", () => {
    const constraint = { constraintId: "inventory_product_a", kind: "INVENTORY_AVAILABILITY", target: { kind: "PRODUCT", ref: "product_a" },
      evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "INELIGIBLE", resourceRequirementId: "units_product_a", availableValue: { kind: "FACT", ref: "inventory.available" } } as const;
    const action = canonicalActionSchema.parse({ ...dependent(), constraints: [constraint], dependencies: [{ dependencyId: "inventory_gate", kind: "HARD_CONSTRAINT_GATE",
      constraintId: constraint.constraintId, requiredStatus: "SATISFIED", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }] });
    const base = context([], action);
    const evidence = { evidenceRef: "inventory.evidence", actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action), constraintId: constraint.constraintId,
      target: constraint.target, evaluationBoundary: "TRANSLATION_TIME", observedAt: NOW, sourceRef: "inventory.snapshot", provenance: ["inventory.source"],
      fact: { kind: "VALUE", valueRef: constraint.availableValue, value: { valueType: "QUANTITY", value: 20, unit: "units" } } };
    const requirements = { inventory_gate: [{ resourceRequirementId: "units_product_a", value: { valueType: "QUANTITY", value: 10, unit: "units" } }] };
    expect(assessActionDependencies(action, { ...base, constraintReceipts: [evidence], constraintResourceRequirements: requirements }).status).toBe("SATISFIED");
    expect(assessActionDependencies(action, { ...base, constraintReceipts: [{ ...evidence, fact: { ...evidence.fact, value: { valueType: "QUANTITY", value: 5, unit: "units" } } }], constraintResourceRequirements: requirements }).status).toBe("BLOCKED");
    expect(assessActionDependencies(action, { ...base, constraintReceipts: [{ ...evidence, target: { kind: "PRODUCT", ref: "product_b" } }], constraintResourceRequirements: requirements }).status).toBe("BLOCKED");
  });

  it("rejects ambiguous registry entries and direct or transitive cycles", () => {
    const action = dependent();
    expect(assessActionDependencies(action, { ...context(), registry: [
      { entityKind: "ACTION", action: prerequisite }, { entityKind: "ACTION", action: prerequisite },
    ] }).checks[0]).toMatchObject({ status: "UNKNOWN", reasonCodes: ["AMBIGUOUS_PREREQUISITE_REGISTRY"] });
    const self = canonicalActionSchema.parse({ ...action, dependencies: [{ ...action.dependencies[0], prerequisite: {
      entityKind: "ACTION", actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) } }] });
    expect(assessActionDependencies(self, { ...context(), registry: [{ entityKind: "ACTION", action: self }] }).status).toBe("BLOCKED");
    const a = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_cycle_a", dependencies: [{ dependencyId: "needs_b", kind: "ENTITY_LIFECYCLE",
      prerequisite: { entityKind: "ACTION", actionId: "action_cycle_b", actionFingerprint: "fnv1a64:bbbbbbbbbbbbbbbb" }, requiredState: "COMPLETED",
      evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }] });
    const b = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_cycle_b", dependencies: [{ dependencyId: "needs_a", kind: "ENTITY_LIFECYCLE",
      prerequisite: { entityKind: "ACTION", actionId: "action_cycle_a", actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }, requiredState: "COMPLETED",
      evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }] });
    expect(assessActionDependencies(a, { ...context([], a), registry: [{ entityKind: "ACTION", action: a }, { entityKind: "ACTION", action: b }] })).toMatchObject({
      status: "BLOCKED", checks: [{ reasonCodes: ["DEPENDENCY_CYCLE"] }],
    });
    const c = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_cycle_c", dependencies: [{ dependencyId: "needs_a", kind: "ENTITY_LIFECYCLE",
      prerequisite: { entityKind: "ACTION", actionId: "action_cycle_a", actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }, requiredState: "COMPLETED", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }] });
    const transitiveB = canonicalActionSchema.parse({ ...b, dependencies: [{ ...b.dependencies[0], prerequisite: { entityKind: "ACTION", actionId: c.actionId, actionFingerprint: "fnv1a64:cccccccccccccccc" } }] });
    expect(assessActionDependencies(a, { ...context([], a), registry: [{ entityKind: "ACTION", action: a }, { entityKind: "ACTION", action: transitiveB }, { entityKind: "ACTION", action: c }] }).status).toBe("BLOCKED");

    const nested = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_nested_cycle", dependencies: [{ dependencyId: "nested_needs_root", kind: "ENTITY_LIFECYCLE",
      prerequisite: { entityKind: "ACTION", actionId: a.actionId, actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }, requiredState: "COMPLETED", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }] });
    const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_action_cycle", components: [
      { componentId: "nested", role: "PRIMARY", action: nested }, { componentId: "support", role: "SUPPORT", action: prerequisite }], ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: [],
      atomicity: "ALL_OR_NOTHING", failurePolicy: "STOP_REMAINING", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
    const rootToCompound = canonicalActionSchema.parse({ ...a, dependencies: [{ ...a.dependencies[0], prerequisite: { entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
    expect(assessActionDependencies(rootToCompound, { ...context([], rootToCompound), registry: [{ entityKind: "COMPOUND", action: compound }] }).status).toBe("BLOCKED");
  });

  it("distinguishes missing registry references from fingerprint mismatches", () => {
    const action = dependent();
    expect(assessActionDependencies(action, { ...context(), registry: [] }).checks[0]).toMatchObject({ reasonCodes: ["MISSING_PREREQUISITE_REGISTRY"] });
    const changed = canonicalActionSchema.parse({ ...prerequisite, what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } } });
    expect(assessActionDependencies(action, { ...context(), registry: [{ entityKind: "ACTION", action: changed }] }).checks[0]).toMatchObject({ reasonCodes: ["PREREQUISITE_FINGERPRINT_MISMATCH"] });
  });

  it("detects cycles through experiment arms", () => {
    const population = canonicalActionSchema.parse(createCanonicalFixtures().find((fixture) => fixture.number === 6)!.action).population!;
    const experimentWhat = (treatmentId: string, treatmentFingerprint: string) => ({ actionType: "experiment.run" as const, hypothesisRef: "hypothesis_cycle", primaryMetricRef: "metric_cycle",
      randomizationUnit: "CUSTOMER" as const, assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" as const },
      arms: [{ armId: "arm_control", role: "CONTROL" as const, actionId: prerequisite.actionId, actionFingerprint: fingerprintCanonicalAction(prerequisite), allocationBasisPoints: 5000 },
        { armId: "arm_treatment", role: "TREATMENT" as const, actionId: treatmentId, actionFingerprint: treatmentFingerprint, allocationBasisPoints: 5000 }],
      stopping: { kind: "FIXED" as const, sampleTarget: 10 }, measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-09-26T04:00:00Z" } });
    const experimentB = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_experiment_cycle_b", population, timing: fridaySevenDayBudgetTiming,
      what: experimentWhat("action_experiment_cycle_a", "fnv1a64:aaaaaaaaaaaaaaaa"), provenance: ["experiment.plan"] });
    const experimentA = canonicalActionSchema.parse({ ...dependent(), actionId: "action_experiment_cycle_a", population,
      what: experimentWhat(experimentB.actionId, fingerprintCanonicalAction(experimentB)) });
    expect(assessActionDependencies(experimentA, { ...context([], experimentA), registry: [
      { entityKind: "ACTION", action: prerequisite }, { entityKind: "ACTION", action: experimentB }, { entityKind: "ACTION", action: experimentA },
    ] })).toMatchObject({ status: "BLOCKED", checks: [{ reasonCodes: ["DEPENDENCY_CYCLE"] }] });
  });

  it("never accepts a lifecycle wrapper status or compound-level lifecycle event", () => {
    const action = dependent();
    expect(() => assessActionDependencies(action, context([{ ...event(), status: "COMPLETED" } as unknown as ReturnType<typeof event>], action))).not.toThrow();
    expect(assessActionDependencies(action, context([{ ...event(), subject: {
      kind: "COMPOUND", compoundActionId: "compound_inventory", compoundFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" } } as unknown as ReturnType<typeof event>], action)).status).toBe("BLOCKED");
  });

  it("requires a valid bound investigation result for RESOLVED", () => {
    const investigation = canonicalActionSchema.parse({
      ...prerequisite, actionId: "action_inventory_investigation",
      what: investigationExamples.supplierLeadTime,
    });
    const action = canonicalActionSchema.parse({ ...dependent("RESOLVED"), dependencies: [{ ...dependent("RESOLVED").dependencies[0],
      prerequisite: { entityKind: "ACTION", actionId: investigation.actionId, actionFingerprint: fingerprintCanonicalAction(investigation) } }] });
    const result = { actionId: investigation.actionId, actionFingerprint: fingerprintCanonicalAction(investigation), status: "RESOLVED",
      evidenceCollected: [{ evidenceId: "requested-evidence", artifactRef: "artifact.inventory" }], coverage: [{ evidenceId: "requested-evidence", fraction: 1 }],
      findings: [], unresolvedEvidenceIds: [], completedAt: NOW, provenance: { sourceRef: "investigation.runner", recordedAt: NOW } };
    expect(assessActionDependencies(action, { ...context([], action), registry: [{ entityKind: "ACTION", action: investigation }], investigationResults: [result] }).status).toBe("SATISFIED");
    expect(assessActionDependencies(action, { ...context([event()], action), registry: [{ entityKind: "ACTION", action: investigation }], investigationResults: [{ ...result, actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }] }).status).toBe("BLOCKED");
  });

  it("replays the exact winback audience fact at the dependency boundary", () => {
    const winback = createCanonicalFixtures().find((fixture) => fixture.number === 6)!.action;
    const action = canonicalActionSchema.parse({ ...winback, dependencies: [{
      dependencyId: "winback_audience", kind: "ELIGIBILITY_CHECK_GATE", checkId: "domain.lifecycle.audience_available",
      evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED", requiredStatus: "SATISFIED",
    }] });
    const raw = evaluateEligibilityForTest(action, "TRANSLATION_TIME", NOW).evaluationContext;
    const base = { ...context([], action), registry: [], eligibilityContexts: { winback_audience: raw } };
    expect(assessActionDependencies(action, base).status).toBe("SATISFIED");
    const audience = raw.domainFacts.find((fact) => fact.factId === "AUDIENCE_AVAILABLE")!;
    expect(assessActionDependencies(action, { ...base, eligibilityContexts: { winback_audience: {
      ...raw, domainFacts: raw.domainFacts.map((fact) => fact === audience ? { ...fact, actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" } : fact),
    } } }).status).toBe("BLOCKED");
    expect(assessActionDependencies(action, { ...base, eligibilityContexts: { winback_audience: {
      ...raw, domainFacts: [...raw.domainFacts, { ...audience, evidenceRef: "domain.audience.duplicate" }],
    } } }).checks[0]).toMatchObject({ status: "UNKNOWN", reasonCodes: ["AMBIGUOUS_BOUND_DOMAIN_FACT"] });
    expect(assessActionDependencies(action, { ...base, maximumAgeSeconds: 60, eligibilityContexts: { winback_audience: {
      ...raw, domainFacts: raw.domainFacts.map((fact) => ({ ...fact, observedAt: "2026-09-22T12:00:00.000Z" })),
    } } }).status).toBe("BLOCKED");
  });

  it("derives compound completion by atomicity with explicit failed or skipped accounting", () => {
    const second = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_inventory_followup" });
    for (const atomicity of ["ALL_OR_NOTHING", "BEST_EFFORT", "DEPENDENCY_GATED"] as const) {
      const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: `compound_inventory_${atomicity.toLowerCase()}`,
        components: [{ componentId: "purchase", role: "PRIMARY", action: prerequisite }, { componentId: "followup", role: "FOLLOWUP", action: second }],
        ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: atomicity === "DEPENDENCY_GATED" ? [{ kind: "REQUIRES", componentId: "followup", dependsOn: "purchase", requiredState: "COMPLETED" }] : [],
        atomicity, failurePolicy: "CONTINUE_INDEPENDENT", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
      const action = canonicalActionSchema.parse({ ...dependent(), dependencies: [{ ...dependent().dependencies[0], prerequisite: {
        entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
      const outcome = { outcomeId: "outcome_followup", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound),
        componentId: "followup", actionId: second.actionId, actionFingerprint: fingerprintCanonicalAction(second), status: "SKIPPED" as const,
        occurredAt: NOW, sourceRef: "execution.ledger", provenance: ["execution.outcome"] };
      const result = assessActionDependencies(action, { ...context([event()], action), registry: [{ entityKind: "COMPOUND", action: compound }], compoundComponentOutcomes: [outcome] });
      expect(result.status).toBe(atomicity === "ALL_OR_NOTHING" ? "BLOCKED" : "SATISFIED");
    }
  });

  it("derives STARTED, EFFECTIVE, and COMPLETED for every compound atomicity mode", () => {
    const second = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_compound_second" });
    const eventFor = (action: typeof prerequisite, kind: "STARTED" | "EFFECTIVE" | "COMPLETED", id: string) => ({
      eventId: id, subject: { kind: "ACTION" as const, actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) },
      eventKind: kind, occurredAt: NOW, sourceRef: "execution.ledger", provenance: ["execution.event"],
    });
    for (const atomicity of ["ALL_OR_NOTHING", "BEST_EFFORT", "DEPENDENCY_GATED"] as const) for (const requiredState of ["STARTED", "EFFECTIVE", "COMPLETED"] as const) {
      const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: `compound_matrix_${atomicity.toLowerCase()}_${requiredState.toLowerCase()}`,
        components: [{ componentId: "root", role: "PRIMARY", action: prerequisite }, { componentId: "downstream", role: "FOLLOWUP", action: second }],
        ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: atomicity === "DEPENDENCY_GATED" ? [{ kind: "REQUIRES", componentId: "downstream", dependsOn: "root", requiredState: "COMPLETED" }] : [],
        atomicity, failurePolicy: "CONTINUE_INDEPENDENT", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
      const action = canonicalActionSchema.parse({ ...dependent(requiredState), dependencies: [{ ...dependent(requiredState).dependencies[0], prerequisite: {
        entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
      const events = atomicity === "DEPENDENCY_GATED" && requiredState !== "COMPLETED"
        ? [eventFor(prerequisite, requiredState, "event_root")]
        : [eventFor(prerequisite, requiredState, "event_root"), eventFor(second, requiredState, "event_downstream")];
      expect(assessActionDependencies(action, { ...context(events, action), registry: [{ entityKind: "COMPOUND", action: compound }] }).status).toBe("SATISFIED");
    }
  });

  it("does not mark BEST_EFFORT effective while a permitted component is unaccounted", () => {
    const second = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_best_effort_unaccounted" });
    const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_best_effort_unaccounted",
      components: [{ componentId: "first", role: "PRIMARY", action: prerequisite }, { componentId: "second", role: "SECONDARY", action: second }], ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING", dependencies: [],
      atomicity: "BEST_EFFORT", failurePolicy: "CONTINUE_INDEPENDENT", rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
    const action = canonicalActionSchema.parse({ ...dependent("EFFECTIVE"), dependencies: [{ ...dependent("EFFECTIVE").dependencies[0], prerequisite: { entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
    expect(assessActionDependencies(action, { ...context([event("EFFECTIVE")], action), registry: [{ entityKind: "COMPOUND", action: compound }] }).status).toBe("BLOCKED");
  });

  it("allows same-instant dependency completion but rejects a pre-gate downstream completion", () => {
    const downstream = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_temporal_downstream" });
    const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_temporal_gate",
      components: [{ componentId: "root", role: "ROOT", action: prerequisite }, { componentId: "downstream", role: "DOWNSTREAM", action: downstream }], ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING",
      dependencies: [{ kind: "REQUIRES", componentId: "downstream", dependsOn: "root", requiredState: "COMPLETED" }], atomicity: "DEPENDENCY_GATED", failurePolicy: "STOP_REMAINING",
      rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
    const action = canonicalActionSchema.parse({ ...dependent(), dependencies: [{ ...dependent().dependencies[0], prerequisite: { entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
    const at = (target: typeof prerequisite, eventId: string, occurredAt: string) => ({ eventId, subject: { kind: "ACTION" as const, actionId: target.actionId, actionFingerprint: fingerprintCanonicalAction(target) },
      eventKind: "COMPLETED" as const, occurredAt, sourceRef: "execution.ledger", provenance: ["execution.event"] });
    const sameInstant = [at(prerequisite, "event_root", NOW), at(downstream, "event_downstream", NOW)];
    const base = { ...context(sameInstant, action), registry: [{ entityKind: "COMPOUND" as const, action: compound }] };
    expect(assessActionDependencies(action, base).status).toBe("SATISFIED");
    expect(assessActionDependencies(action, { ...base, dependencyReceipts: context([
      at(prerequisite, "event_root", NOW), at(downstream, "event_downstream", "2026-09-22T13:59:59.000Z"),
    ], action).dependencyReceipts }).status).toBe("BLOCKED");
  });

  it("accounts for dependency-gated root failures and skipped downstream work under every failure policy", () => {
    const downstream = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_failure_downstream" });
    for (const failurePolicy of ["STOP_REMAINING", "CONTINUE_INDEPENDENT", "REQUEST_ROLLBACK"] as const) {
      const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: `compound_failure_${failurePolicy.toLowerCase()}`,
        components: [{ componentId: "root", role: "PRIMARY", action: prerequisite }, { componentId: "downstream", role: "FOLLOWUP", action: downstream }], ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING",
        dependencies: [{ kind: "REQUIRES", componentId: "downstream", dependsOn: "root", requiredState: "COMPLETED" }], atomicity: "DEPENDENCY_GATED", failurePolicy,
        rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
      const action = canonicalActionSchema.parse({ ...dependent(), dependencies: [{ ...dependent().dependencies[0], prerequisite: { entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
      const outcomes = compound.components.map((component, index) => ({ outcomeId: `outcome_${index}`, compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound), componentId: component.componentId,
        actionId: component.action.actionId, actionFingerprint: fingerprintCanonicalAction(component.action), status: index === 0 ? "FAILED" as const : "SKIPPED" as const,
        occurredAt: NOW, sourceRef: "execution.ledger", provenance: ["execution.outcome"] }));
      expect(assessActionDependencies(action, { ...context([event("STARTED")], action), registry: [{ entityKind: "COMPOUND", action: compound }], compoundComponentOutcomes: outcomes }).status).toBe("SATISFIED");
    }
  });

  it("requires a validated investigation result to unblock a compound RESOLVED edge", () => {
    const investigation = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_compound_investigation", what: investigationExamples.supplierLeadTime });
    const downstream = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_after_investigation" });
    const compound = compoundActionSchema.parse({ schemaVersion: 1, kind: "compound_action", compoundActionId: "compound_resolved_edge",
      components: [{ componentId: "investigate", role: "PREREQUISITE", action: investigation }, { componentId: "act", role: "PRIMARY", action: downstream }], ordering: "UNORDERED", concurrency: "INDEPENDENT_TIMING",
      dependencies: [{ kind: "REQUIRES", componentId: "act", dependsOn: "investigate", requiredState: "RESOLVED" }], atomicity: "DEPENDENCY_GATED", failurePolicy: "STOP_REMAINING",
      rollbackPolicy: "NO_AUTOMATIC_ROLLBACK", constraints: [], populationRelationships: [], measurementHorizon: { amount: 1, unit: "DAY" }, provenance: ["compound.plan"] });
    const action = canonicalActionSchema.parse({ ...dependent(), dependencies: [{ ...dependent().dependencies[0], prerequisite: { entityKind: "COMPOUND", compoundActionId: compound.compoundActionId, compoundFingerprint: fingerprintCompoundAction(compound) } }] });
    const events = [investigation, downstream].map((component, index) => ({ eventId: `event_resolved_${index}`, subject: { kind: "ACTION" as const, actionId: component.actionId, actionFingerprint: fingerprintCanonicalAction(component) },
      eventKind: "COMPLETED" as const, occurredAt: NOW, sourceRef: "execution.ledger", provenance: ["execution.event"] }));
    const base = { ...context(events, action), registry: [{ entityKind: "COMPOUND" as const, action: compound }] };
    expect(assessActionDependencies(action, base).status).toBe("BLOCKED");
    const result = { actionId: investigation.actionId, actionFingerprint: fingerprintCanonicalAction(investigation), status: "RESOLVED", evidenceCollected: [{ evidenceId: "requested-evidence", artifactRef: "artifact.inventory" }],
      coverage: [{ evidenceId: "requested-evidence", fraction: 1 }], findings: [], unresolvedEvidenceIds: [], completedAt: NOW, provenance: { sourceRef: "investigation.runner", recordedAt: NOW } };
    expect(assessActionDependencies(action, { ...base, investigationResults: [result] }).status).toBe("SATISFIED");
    expect(assessActionDependencies(action, { ...base, investigationResults: [{ ...result, actionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }] }).status).toBe("BLOCKED");
    const first = assessActionDependencies(action, { ...base, investigationResults: [result] });
    const changedResult = { ...result, evidenceCollected: [{ evidenceId: "requested-evidence", artifactRef: "artifact.changed" }] };
    const changed = assessActionDependencies(action, { ...base, investigationResults: [changedResult] });
    expect(first.checks[0]!.evidenceRefs).toContain("artifact.inventory");
    expect(changed.checks[0]!.evidenceRefs).toContain("artifact.changed");
    expect(changed.assessmentFingerprint).not.toBe(first.assessmentFingerprint);
    const earlyDownstream = events.map((value, index) => index === 1 ? { ...value, occurredAt: "2026-09-22T13:59:59.000Z" } : value);
    expect(assessActionDependencies(action, { ...context(earlyDownstream, action), registry: base.registry, investigationResults: [result] }).status).toBe("BLOCKED");
  });

  it("uses the exact structured eligible-traffic check at the dependency level", () => {
    const definition = { schemaVersion: 1 as const, populationId: "population_dependency_traffic", version: 1, universe: "ALL_CUSTOMERS" as const,
      inclusion: { kind: "COMPLETED_ORDER_COUNT" as const, operator: "GTE" as const, value: 0 }, exclusions: [], membershipMode: "DYNAMIC_MEMBERSHIP" as const,
      binding: "DECISION_TIME" as const, provenance: ["evidence_population"] };
    const evaluation = evaluatePopulation(definition, { evaluatedAt: NOW, customers: [{ customerId: "customer_one", completedOrderCount: 1 }, { customerId: "customer_two", completedOrderCount: 1 }] });
    const population = { populationId: definition.populationId, version: 1, definitionFingerprint: fingerprintPopulationDefinition(definition), binding: definition.binding, membershipMode: definition.membershipMode };
    const treatment = canonicalActionSchema.parse({ ...prerequisite, actionId: "action_traffic_treatment", what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } } });
    const makeAction = (sampleTarget?: number) => canonicalActionSchema.parse({ ...dependent(), actionId: "action_traffic_experiment", population,
      dependencies: [{ dependencyId: "traffic_gate", kind: "EXPERIMENT_READINESS_GATE", requirement: "SUFFICIENT_ELIGIBLE_TRAFFIC", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" }],
      what: { actionType: "experiment.run", hypothesisRef: "hypothesis_traffic", primaryMetricRef: "metric_traffic", randomizationUnit: "CUSTOMER",
        assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, arms: [
          { armId: "arm_control", role: "CONTROL", actionId: prerequisite.actionId, actionFingerprint: fingerprintCanonicalAction(prerequisite), allocationBasisPoints: 5000 },
          { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment), allocationBasisPoints: 5000 }],
        stopping: sampleTarget === undefined ? { kind: "FIXED", timingHorizon: "ENVELOPE_TIMING" } : { kind: "FIXED", sampleTarget },
        measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-09-26T04:00:00Z" } } });
    const readiness = (action: ReturnType<typeof makeAction>, overrides: Record<string, unknown> = {}) => ({ armRegistry: [{ entityKind: "ACTION", action: prerequisite }, { entityKind: "ACTION", action: treatment }], graphRegistry: [],
      timing: { approvedClock: NOW }, populations: [definition], evaluations: [evaluation], bindingTimes: { DECISION_TIME: NOW }, metricDefinitions: [{ metricRef: "metric_traffic", evidenceRefs: ["metric.evidence"] }],
      eligibleTraffic: { experimentActionFingerprint: fingerprintCanonicalAction(action), ...population, evaluatedAt: NOW, rawSourceObservedAt: NOW,
        rawSourceFingerprint: fingerprintExperimentTrafficSource(evaluation), maximumAgeSeconds: 3600, evidenceRefs: ["traffic.evidence"] },
      engineCapability: { status: "AVAILABLE", randomizationUnits: ["CUSTOMER"], evidenceRefs: ["engine.evidence"] }, customRandomizationRegistrations: [], ...overrides });
    const assess = (action: ReturnType<typeof makeAction>, readinessContext: Record<string, unknown>) => assessActionDependencies(action, {
      ...context([], action), experimentReadinessContexts: { traffic_gate: readinessContext },
    });
    const action = makeAction(2);
    expect(assess(action, readiness(action)).status).toBe("SATISFIED");
    expect(assess(action, readiness(action, { engineCapability: { status: "UNAVAILABLE", randomizationUnits: ["CUSTOMER"], evidenceRefs: ["engine.evidence"] } })).status).toBe("SATISFIED");
    for (const eligibleTraffic of [
      { ...readiness(action).eligibleTraffic, evaluatedAt: "2026-09-22T15:00:00.000Z" },
      { ...readiness(action).eligibleTraffic, rawSourceObservedAt: "2026-09-22T12:00:00.000Z", maximumAgeSeconds: 60 },
      { ...readiness(action).eligibleTraffic, rawSourceFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" },
      { ...readiness(action).eligibleTraffic, populationId: "population_other" },
    ]) expect(assess(action, readiness(action, { eligibleTraffic })).status).toBe("BLOCKED");
    expect(assess(makeAction(), readiness(makeAction())) .status).toBe("BLOCKED");
    expect(assess(makeAction(3), readiness(makeAction(3))).status).toBe("BLOCKED");
  });
});
