import { describe, expect, it } from "vitest";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { createPopulationSnapshot, evaluatePopulation, fingerprintPopulationDefinition } from "../../src/population/index.js";
import { createCompoundFixtures, fingerprintCompoundAction } from "../../src/compound_action/index.js";
import { experimentWhatSchema } from "../../src/experiment/index.js";
import { fingerprintEligibilityAssessment } from "../../src/action_eligibility/integrity.js";
import { evaluateActionEligibility } from "../../src/action_eligibility/evaluate.js";

const NOW = "2026-09-22T14:00:00.000Z";
const populationDefinition = {
  schemaVersion: 1 as const,
  populationId: "population_translation_experiment",
  version: 1,
  universe: "ALL_CUSTOMERS" as const,
  inclusion: { kind: "COMPLETED_ORDER_COUNT" as const, operator: "GTE" as const, value: 0 },
  exclusions: [],
  membershipMode: "DYNAMIC_MEMBERSHIP" as const,
  binding: "DECISION_TIME" as const,
  provenance: ["evidence_population"],
};
const population = {
  populationId: populationDefinition.populationId,
  version: 1,
  definitionFingerprint: fingerprintPopulationDefinition(populationDefinition),
  binding: populationDefinition.binding,
  membershipMode: populationDefinition.membershipMode,
};
const evaluation = evaluatePopulation(populationDefinition, { evaluatedAt: NOW, customers: [{ customerId: "customer_one", completedOrderCount: 1 }] });
const control = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_translation_control", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing: fridaySevenDayBudgetTiming, provenance: ["evidence_control"] });
const treatment = canonicalActionSchema.parse({ ...control, actionId: "action_translation_treatment", what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PAID_MEDIA" } } });
const action = canonicalActionSchema.parse({
  schemaVersion: "2.0.0",
  actionId: "action_translation_experiment",
  population,
  timing: fridaySevenDayBudgetTiming,
  provenance: ["evidence_experiment"],
  what: {
    actionType: "experiment.run",
    hypothesisRef: "hypothesis_translation",
    primaryMetricRef: "metric_conversion",
    randomizationUnit: "CUSTOMER",
    assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" },
    arms: [
      { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
      { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment), allocationBasisPoints: 5000 },
    ],
    stopping: { kind: "FIXED", sampleTarget: 100, timingHorizon: "ENVELOPE_TIMING" },
    measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-10-02T04:00:00Z" },
  },
});

function eligibilityFor(actionValue: typeof action, overrides: Record<string, unknown> = {}) {
  const assessment = {
    actionId: actionValue.actionId,
    actionFingerprint: fingerprintCanonicalAction(actionValue),
    evaluatedAt: NOW,
    evaluationBoundary: "TRANSLATION_TIME",
    status: "ELIGIBLE",
    checks: [],
    ...overrides,
  };
  return { ...assessment, assessmentFingerprint: fingerprintEligibilityAssessment(assessment as never) };
}
function eligibility(overrides: Record<string, unknown> = {}) { return eligibilityFor(action, overrides); }

function context(overrides: Record<string, unknown> = {}) {
  const supplied = (overrides["eligibility"] ?? eligibility()) as { evaluatedAt?: string; evaluationBoundary?: string };
  return {
    timing: { approvedClock: NOW },
    populations: [populationDefinition],
    evaluations: [evaluation],
    bindingTimes: { DECISION_TIME: NOW },
    eligibility: eligibility(),
    eligibilityEvaluationContext: { evaluatedAt: supplied.evaluatedAt ?? NOW, evaluationBoundary: supplied.evaluationBoundary ?? "TRANSLATION_TIME", observations: [], constraintReceipts: [], domainFacts: [] },
    eligibilityResourceRequirements: [],
    eligibilityMaximumAgeSeconds: 3600,
    experimentArmRegistry: [
      { entityKind: "ACTION", action: control },
      { entityKind: "ACTION", action: treatment },
    ],
    portfolioReferences: [
      { entityKind: "ACTION", actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) },
    ],
    portfolioCompatibilityContext: {
      evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", maximumAgeSeconds: 3600,
      registry: [{ entityKind: "ACTION", action }, { entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }],
      timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [],
    },
    ...overrides,
  };
}
function portfolioFor(actionValue: typeof action) {
  return {
    portfolioReferences: [{ entityKind: "ACTION", actionId: actionValue.actionId, actionFingerprint: fingerprintCanonicalAction(actionValue) }],
    portfolioCompatibilityContext: { evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", maximumAgeSeconds: 3600, registry: [{ entityKind: "ACTION", action: actionValue }, { entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] },
  };
}

function evaluatedFor(actionValue: typeof action, decision?: "SATISFIED" | "VIOLATED") {
  const constraint = actionValue.constraints[0];
  const raw = {
    evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME" as const, observations: [], domainFacts: [],
    constraintReceipts: !constraint || decision === undefined ? [] : [{
      evidenceRef: "policy.evidence", actionId: actionValue.actionId, actionFingerprint: fingerprintCanonicalAction(actionValue),
      constraintId: constraint.constraintId, target: constraint.target, evaluationBoundary: "TRANSLATION_TIME" as const,
      observedAt: NOW, sourceRef: "policy", provenance: ["policy:1"],
      fact: { kind: "CUSTOM" as const, registryRef: constraint.kind === "CUSTOM" ? constraint.registryRef : "unsupported", code: constraint.kind === "CUSTOM" ? constraint.code : "unsupported", decision },
    }],
  };
  const result = evaluateActionEligibility({ action: actionValue, nativeConstraints: { constraints: actionValue.constraints, resourceRequirements: [] } }, raw);
  if (!result.ok) throw new Error(result.failure.messages.join(", "));
  return { eligibility: result.result, raw };
}

describe("native experiment translation", () => {
  it("emits a structured engine task and no commercial interventions", () => {
    const result = translateCanonicalAction(action, context());
    expect(result).toMatchObject({ status: "TRANSLATED", decisionType: "EXPERIMENT", interventions: [] });
    if (result.status !== "TRANSLATED") return;
    expect(result.experimentTasks).toEqual([{
      actionId: action.actionId,
      actionFingerprint: fingerprintCanonicalAction(action),
      specification: action.what,
      population: action.population,
      timing: action.timing,
      eligibility: { evaluationBoundary: "TRANSLATION_TIME", evaluatedAt: NOW },
    }]);
  });

  it.each([
    ["missing eligibility", { eligibility: undefined }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_REQUIRED"],
    ["mismatched action", { eligibility: eligibility({ actionId: "action_other" }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_MISMATCH"],
    ["mismatched fingerprint", { eligibility: eligibility({ actionFingerprint: "fnv1a64:0000000000000000" }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_MISMATCH"],
    ["wrong boundary", { eligibility: eligibility({ evaluationBoundary: "DECISION_TIME" }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_BOUNDARY"],
    ["missing freshness policy", { eligibilityMaximumAgeSeconds: undefined }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_FRESHNESS_REQUIRED"],
    ["stale eligibility", { eligibility: eligibility({ evaluatedAt: "2026-09-22T12:59:59.000Z" }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_STALE"],
    ["future eligibility", { eligibility: eligibility({ evaluatedAt: "2026-09-22T14:00:01.000Z" }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_FUTURE"],
  ])("rejects %s", (_label, overrides, status, code) => {
    expect(translateCanonicalAction(action, context(overrides))).toMatchObject({ status, code });
  });

  it("maps ineligible evidence to an explicit failure", () => {
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [{ constraintId: "budget", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "budget", code: "AVAILABLE" }] });
    const evaluated = evaluatedFor(constrained, "VIOLATED");
    expect(translateCanonicalAction(constrained, context({ ...portfolioFor(constrained), eligibility: evaluated.eligibility, eligibilityEvaluationContext: evaluated.raw }))).toMatchObject({ status: "INELIGIBLE_ACTION", code: "EXPERIMENT_INELIGIBLE" });
  });

  it("maps a complete unknown assessment to missing context", () => {
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [{ constraintId: "budget", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "budget", code: "AVAILABLE" }] });
    const evaluated = evaluatedFor(constrained);
    expect(translateCanonicalAction(constrained, context({ ...portfolioFor(constrained), eligibility: evaluated.eligibility, eligibilityEvaluationContext: evaluated.raw }))).toMatchObject({ status: "MISSING_CONTEXT", code: "EXPERIMENT_ELIGIBILITY_UNKNOWN" });
  });

  it("rejects a mutated check whose assessment fingerprint was not recomputed", () => {
    const valid = eligibility();
    const mutated = { ...valid, checks: [{ kind: "DOMAIN_RULE", checkId: "forged", status: "SATISFIED", reasonCodes: ["FORGED"], evidenceRefs: ["forged.evidence"], missingInformation: [] }] };
    expect(translateCanonicalAction(action, context({ eligibility: mutated }))).toMatchObject({ status: "INVALID_ACTION", code: "INVALID_EXPERIMENT_ELIGIBILITY_INTEGRITY" });
  });

  it("rejects a forged eligible aggregate containing a violated check", () => {
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [{ constraintId: "budget", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "budget", code: "AVAILABLE" }] });
    const forged = eligibilityFor(constrained, { checks: [{ kind: "HARD_CONSTRAINT", checkId: "budget", status: "VIOLATED", reasonCodes: ["CONSTRAINT_VIOLATED"], evidenceRefs: ["budget.evidence"], missingInformation: [] }] });
    expect(translateCanonicalAction(constrained, context({ eligibility: forged }))).toMatchObject({ status: "INVALID_ACTION", code: "EXPERIMENT_ELIGIBILITY_RECOMPUTATION_MISMATCH" });
  });

  it.each([
    ["absent arm", [{ entityKind: "ACTION", action: control }], "EXPERIMENT_ARM_REQUIRED"],
    ["ambiguous arm", [{ entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }, { entityKind: "ACTION", action: treatment }], "AMBIGUOUS_EXPERIMENT_ARM"],
    ["mismatched arm fingerprint", [{ entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: { ...treatment, what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } } } }], "EXPERIMENT_ARM_FINGERPRINT_MISMATCH"],
    ["unrelated extra arm", [{ entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }, { entityKind: "ACTION", action: canonicalActionSchema.parse({ ...control, actionId: "action_unrelated_arm" }) }], "EXPERIMENT_ARM_REGISTRY_EXACT_SET_REQUIRED"],
  ])("rejects %s registry resolution", (_label, experimentArmRegistry, code) => {
    expect(translateCanonicalAction(action, context({ experimentArmRegistry }))).toMatchObject({ status: "MISSING_CONTEXT", code });
  });

  it("requires the complete exact arm portfolio and translation-time freshness", () => {
    const base = context();
    const refs = base.portfolioReferences;
    expect(translateCanonicalAction(action, { ...base, portfolioReferences: [] })).toMatchObject({ code: "EXPERIMENT_PORTFOLIO_REFERENCE_MISMATCH" });
    expect(translateCanonicalAction(action, { ...base, portfolioReferences: [...refs, refs[0]] })).toMatchObject({ code: "EXPERIMENT_PORTFOLIO_REFERENCE_MISMATCH" });
    const external = canonicalActionSchema.parse({ ...control, actionId: "action_concurrent_external" });
    expect(translateCanonicalAction(action, { ...base, portfolioReferences: [...refs, { entityKind: "ACTION", actionId: external.actionId, actionFingerprint: fingerprintCanonicalAction(external) }], portfolioCompatibilityContext: { ...base.portfolioCompatibilityContext, registry: [...base.portfolioCompatibilityContext.registry, { entityKind: "ACTION", action: external }] } })).toMatchObject({ status: "TRANSLATED" });
    expect(translateCanonicalAction(action, { ...base, portfolioCompatibilityContext: { ...base.portfolioCompatibilityContext, evaluationBoundary: "DECISION_TIME" } })).toMatchObject({ code: "EXPERIMENT_PORTFOLIO_COMPATIBILITY_MISMATCH" });
    const { maximumAgeSeconds: _age, ...withoutFreshness } = base.portfolioCompatibilityContext;
    expect(translateCanonicalAction(action, { ...base, portfolioCompatibilityContext: withoutFreshness })).toMatchObject({ code: "EXPERIMENT_PORTFOLIO_COMPATIBILITY_MISMATCH" });
  });

  it("rejects a global arm conflict before emitting an experiment task", () => {
    const right = canonicalActionSchema.parse({ ...treatment, actionId: "action_global_conflict_right" });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const left = canonicalActionSchema.parse({ ...control, actionId: "action_global_conflict_left", conflicts: [{ conflictId: "global.write", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "GLOBAL" }, scope: { coordinates: [{ kind: "GLOBAL" }] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: rightRef }] });
    const conflicting = canonicalActionSchema.parse({ ...action, actionId: "action_global_conflict_experiment", what: { ...action.what, arms: [{ armId: "arm_control", role: "CONTROL", actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left), allocationBasisPoints: 5000 }, { armId: "arm_treatment", role: "TREATMENT", actionId: right.actionId, actionFingerprint: rightRef.actionFingerprint, allocationBasisPoints: 5000 }] } });
    const bound = eligibilityFor(conflicting);
    const result = translateCanonicalAction(conflicting, context({ ...portfolioFor(conflicting), eligibility: bound, experimentArmRegistry: [{ entityKind: "ACTION", action: left }, { entityKind: "ACTION", action: right }], portfolioCompatibilityContext: { ...portfolioFor(conflicting).portfolioCompatibilityContext, registry: [{ entityKind: "ACTION", action: conflicting }, { entityKind: "ACTION", action: left }, { entityKind: "ACTION", action: right }] } }));
    expect(result).toMatchObject({ status: "INELIGIBLE_ACTION", code: "EXPERIMENT_PORTFOLIO_CONFLICT" });
  });

  it("accepts population-scoped arm writes only with an exact disjoint partition receipt", () => {
    const coordinate = { kind: "POPULATION" as const, populationId: population.populationId, version: population.version, definitionFingerprint: population.definitionFingerprint, binding: population.binding, membershipMode: population.membershipMode };
    const right = canonicalActionSchema.parse({ ...treatment, actionId: "action_partition_right", population });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const left = canonicalActionSchema.parse({ ...control, actionId: "action_partition_left", population, conflicts: [{ conflictId: "population.write", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "POPULATION", ref: population.populationId }, scope: { coordinates: [coordinate] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: rightRef }] });
    const partitioned = canonicalActionSchema.parse({ ...action, actionId: "action_partition_experiment", what: { ...action.what, arms: [{ armId: "arm_control", role: "CONTROL", actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left), allocationBasisPoints: 5000 }, { armId: "arm_treatment", role: "TREATMENT", actionId: right.actionId, actionFingerprint: rightRef.actionFingerprint, allocationBasisPoints: 5000 }] } });
    const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
    const pairKey = [`ACTION:${left.actionId}:${leftRef.actionFingerprint}`, `ACTION:${right.actionId}:${rightRef.actionFingerprint}`].sort().join("|");
    const receipt = { receiptId: "receipt.partition.translation", experimentActionId: partitioned.actionId, experimentActionFingerprint: fingerprintCanonicalAction(partitioned), populationId: population.populationId, populationVersion: population.version, populationFingerprint: population.definitionFingerprint, populationBinding: population.binding, assignmentBoundary: "USE_ENVELOPE_POPULATION_BINDING", leftArmId: "arm_control", rightArmId: "arm_treatment", pairKey, evaluationBoundary: "TRANSLATION_TIME", observedAt: NOW, windowStart: "2026-09-25T04:00:00Z", windowEnd: "2026-10-02T04:00:00Z", leftOccurrenceIndexes: [0], rightOccurrenceIndexes: [0], disjoint: true, sourceRef: "assignment.partition", provenance: ["assignment.snapshot"] };
    const portfolio = portfolioFor(partitioned);
    const overrides = { ...portfolio, eligibility: eligibilityFor(partitioned), experimentArmRegistry: [{ entityKind: "ACTION", action: left }, { entityKind: "ACTION", action: right }], portfolioCompatibilityContext: { ...portfolio.portfolioCompatibilityContext, registry: [{ entityKind: "ACTION", action: partitioned }, { entityKind: "ACTION", action: left }, { entityKind: "ACTION", action: right }], partitionReceipts: [receipt] } };
    expect(translateCanonicalAction(partitioned, context({ ...overrides, portfolioCompatibilityContext: { ...overrides.portfolioCompatibilityContext, partitionReceipts: [] } }))).toMatchObject({ status: "MISSING_CONTEXT", code: "EXPERIMENT_PORTFOLIO_COMPATIBILITY_UNKNOWN" });
    expect(translateCanonicalAction(partitioned, context(overrides))).toMatchObject({ status: "TRANSLATED", decisionType: "EXPERIMENT" });
  });

  it("resolves compound arm identity and fingerprint exactly", () => {
    const compound = createCompoundFixtures()[7]!.action;
    const experimentWhat = experimentWhatSchema.parse(action.what);
    const compoundExperiment = canonicalActionSchema.parse({
      ...action,
      actionId: "action_translation_compound_experiment",
      what: {
        ...action.what,
        arms: [
          experimentWhat.arms[0],
          { entityKind: "COMPOUND", armId: "arm_treatment", role: "TREATMENT", compoundActionId: compound.compoundActionId, actionFingerprint: fingerprintCompoundAction(compound), allocationBasisPoints: 5000 },
        ],
      },
    });
    const bound = eligibility({ actionId: compoundExperiment.actionId, actionFingerprint: fingerprintCanonicalAction(compoundExperiment) });
    const portfolioReferences = [{ entityKind: "ACTION", actionId: compoundExperiment.actionId, actionFingerprint: fingerprintCanonicalAction(compoundExperiment) }];
    const portfolioCompatibilityContext = { evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", maximumAgeSeconds: 3600, registry: [{ entityKind: "ACTION", action: compoundExperiment }, { entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: compound }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] };
    const result = translateCanonicalAction(compoundExperiment, context({ eligibility: bound, experimentArmRegistry: [{ entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: compound }], portfolioReferences, portfolioCompatibilityContext }));
    expect(result.status).toBe("TRANSLATED");
    const tampered = {
      ...compound,
      components: compound.components.map((component, index) => index === 0
        ? { ...component, role: `${component.role}_tampered` }
        : component),
    };
    expect(translateCanonicalAction(compoundExperiment, context({ eligibility: bound, experimentArmRegistry: [{ entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: tampered }], portfolioReferences, portfolioCompatibilityContext }))).toMatchObject({ status: "MISSING_CONTEXT", code: "EXPERIMENT_ARM_FINGERPRINT_MISMATCH" });
  });

  it("requires complete, unique translation-time hard-constraint checks", () => {
    const constraint = { constraintId: "experiment.translation.policy", kind: "CUSTOM" as const, target: { kind: "GLOBAL" as const }, evaluationBoundary: "TRANSLATION_TIME" as const, whenUnknown: "UNKNOWN" as const, registryRef: "experiment.policy", code: "ENGINE_ALLOWED" };
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [constraint] });
    const evaluated = evaluatedFor(constrained, "SATISFIED");
    const satisfied = evaluated.eligibility.checks[0]!;
    const translate = (checks: unknown[]) => translateCanonicalAction(constrained, context({ ...portfolioFor(constrained), eligibility: eligibilityFor(constrained, { checks }), eligibilityEvaluationContext: evaluated.raw }));
    expect(translateCanonicalAction(constrained, context({ ...portfolioFor(constrained), eligibility: evaluated.eligibility, eligibilityEvaluationContext: evaluated.raw })).status).toBe("TRANSLATED");
    expect(translate([])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
    expect(translate([satisfied, satisfied])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
    expect(translate([satisfied, { ...satisfied, checkId: "unexpected" }])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
  });

  it.each([
    ["population definition", { populations: [populationDefinition, structuredClone(populationDefinition)] }, "AMBIGUOUS_POPULATION_DEFINITION"],
    ["dynamic evaluation", { evaluations: [evaluation, structuredClone(evaluation)] }, "AMBIGUOUS_DYNAMIC_MEMBERSHIP"],
  ])("rejects duplicate exact %s matches", (_label, overrides, code) => {
    expect(translateCanonicalAction(action, context(overrides))).toMatchObject({ status: "MISSING_CONTEXT", code });
  });

  it("rejects duplicate exact frozen population snapshots", () => {
    const definition = { ...populationDefinition, membershipMode: "FROZEN_MEMBERSHIP" as const };
    const evaluated = evaluatePopulation(definition, { evaluatedAt: NOW, customers: [{ customerId: "customer_one", completedOrderCount: 1 }] });
    const snapshot = createPopulationSnapshot(definition, evaluated, { snapshotId: "snapshot_translation_experiment" });
    const frozen = canonicalActionSchema.parse({
      ...action,
      population: {
        populationId: definition.populationId,
        version: definition.version,
        definitionFingerprint: fingerprintPopulationDefinition(definition),
        binding: definition.binding,
        membershipMode: definition.membershipMode,
        snapshotRef: snapshot.snapshotId,
      },
    });
    const bound = eligibility({ actionFingerprint: fingerprintCanonicalAction(frozen) });
    expect(translateCanonicalAction(frozen, context({ populations: [definition], evaluations: [], snapshots: [snapshot, structuredClone(snapshot)], eligibility: bound }))).toMatchObject({ status: "MISSING_CONTEXT", code: "AMBIGUOUS_FROZEN_MEMBERSHIP" });
  });
});
