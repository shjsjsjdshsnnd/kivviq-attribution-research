import { describe, expect, it } from "vitest";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { evaluatePopulation, fingerprintPopulationDefinition } from "../../src/population/index.js";
import { createCompoundFixtures, fingerprintCompoundAction } from "../../src/compound_action/index.js";
import { experimentWhatSchema } from "../../src/experiment/index.js";

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

function eligibility(overrides: Record<string, unknown> = {}) {
  return {
    actionId: action.actionId,
    actionFingerprint: fingerprintCanonicalAction(action),
    evaluatedAt: NOW,
    evaluationBoundary: "TRANSLATION_TIME",
    status: "ELIGIBLE",
    checks: [],
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    timing: { approvedClock: NOW },
    populations: [populationDefinition],
    evaluations: [evaluation],
    bindingTimes: { DECISION_TIME: NOW },
    eligibility: eligibility(),
    eligibilityMaximumAgeSeconds: 3600,
    experimentArmRegistry: [
      { entityKind: "ACTION", action: control },
      { entityKind: "ACTION", action: treatment },
    ],
    ...overrides,
  };
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
    ["unknown eligibility", { eligibility: eligibility({ status: "UNKNOWN", checks: [{ kind: "HARD_CONSTRAINT", checkId: "budget", status: "UNKNOWN", reasonCodes: ["MISSING_BOUND_EVIDENCE"], evidenceRefs: [], missingInformation: ["budget"] }] }) }, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_UNKNOWN"],
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
    const check = { kind: "HARD_CONSTRAINT", checkId: "budget", status: "VIOLATED", reasonCodes: ["CONSTRAINT_VIOLATED"], evidenceRefs: ["budget.evidence"], missingInformation: [] };
    expect(translateCanonicalAction(action, context({ eligibility: eligibility({ status: "INELIGIBLE", checks: [check] }) }))).toMatchObject({ status: "INELIGIBLE_ACTION", code: "EXPERIMENT_INELIGIBLE" });
  });

  it("rejects a forged eligible aggregate containing a violated check", () => {
    const forged = eligibility({ checks: [{ kind: "HARD_CONSTRAINT", checkId: "budget", status: "VIOLATED", reasonCodes: ["CONSTRAINT_VIOLATED"], evidenceRefs: ["budget.evidence"], missingInformation: [] }] });
    expect(translateCanonicalAction(action, context({ eligibility: forged }))).toMatchObject({ status: "INVALID_ACTION", code: "INVALID_EXPERIMENT_ELIGIBILITY" });
  });

  it.each([
    ["absent arm", [{ entityKind: "ACTION", action: control }], "EXPERIMENT_ARM_REQUIRED"],
    ["ambiguous arm", [{ entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }, { entityKind: "ACTION", action: treatment }], "AMBIGUOUS_EXPERIMENT_ARM"],
    ["mismatched arm fingerprint", [{ entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: { ...treatment, what: { actionType: "no_op.do_nothing", scope: { kind: "FAMILY", family: "PRICING" } } } }], "EXPERIMENT_ARM_FINGERPRINT_MISMATCH"],
  ])("rejects %s registry resolution", (_label, experimentArmRegistry, code) => {
    expect(translateCanonicalAction(action, context({ experimentArmRegistry }))).toMatchObject({ status: "MISSING_CONTEXT", code });
  });

  it("resolves compound arm identity and fingerprint exactly", () => {
    const compound = createCompoundFixtures()[0]!.action;
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
    const result = translateCanonicalAction(compoundExperiment, context({ eligibility: bound, experimentArmRegistry: [{ entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: compound }] }));
    expect(result.status).toBe("TRANSLATED");
    const tampered = {
      ...compound,
      components: compound.components.map((component, index) => index === 0
        ? { ...component, role: `${component.role}_tampered` }
        : component),
    };
    expect(translateCanonicalAction(compoundExperiment, context({ eligibility: bound, experimentArmRegistry: [{ entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: tampered }] }))).toMatchObject({ status: "MISSING_CONTEXT", code: "EXPERIMENT_ARM_FINGERPRINT_MISMATCH" });
  });

  it("requires complete, unique translation-time hard-constraint checks", () => {
    const constraint = { constraintId: "experiment.translation.policy", kind: "CUSTOM" as const, target: { kind: "GLOBAL" as const }, evaluationBoundary: "TRANSLATION_TIME" as const, whenUnknown: "UNKNOWN" as const, registryRef: "experiment.policy", code: "ENGINE_ALLOWED" };
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [constraint] });
    const base = eligibility({ actionFingerprint: fingerprintCanonicalAction(constrained) });
    const satisfied = { kind: "HARD_CONSTRAINT", checkId: constraint.constraintId, status: "SATISFIED", reasonCodes: ["CUSTOM_SATISFIED"], evidenceRefs: ["policy.evidence"], missingInformation: [] };
    const translate = (checks: unknown[]) => translateCanonicalAction(constrained, context({ eligibility: { ...base, checks } }));
    expect(translate([satisfied]).status).toBe("TRANSLATED");
    expect(translate([])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
    expect(translate([satisfied, satisfied])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
    expect(translate([satisfied, { ...satisfied, checkId: "unexpected" }])).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_EXPERIMENT_ELIGIBILITY" });
  });
});
