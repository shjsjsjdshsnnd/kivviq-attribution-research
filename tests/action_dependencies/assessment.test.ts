import { describe, expect, it } from "vitest";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { canonicalActionSchema, fingerprintCanonicalAction } from "../../src/canonical_action/index.js";
import { assessActionDependencies, fingerprintDependencyAssessment } from "../../src/action_dependencies/index.js";
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { evaluateEligibilityForTest } from "../action_translation/eligibility-helper.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../../src/compound_action/index.js";

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
});
