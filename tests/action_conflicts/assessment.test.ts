import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { setSkuA849Cad, setSkuA949EffectiveOctober1 } from "../../src/pricing/fixtures.js";
import { assessPortfolioCompatibility, assessScopeIntersection, fingerprintConflictScope } from "../../src/action_conflicts/index.js";

const evaluatedAt = "2026-09-20T13:00:00Z";
const boundary = "DECISION_TIME" as const;

describe("portfolio compatibility assessment", () => {
  it("allows multiple actions to share a registered adapter", () => {
    const base = adaptLegacyAction(setSkuA849Cad);
    const first = canonicalActionSchema.parse({ ...base, actionId: "action_adapter_first" });
    const second = canonicalActionSchema.parse({ ...base, actionId: "action_adapter_second" });
    const target = canonicalActionSchema.parse({
      ...base,
      actionId: "action_adapter_target",
      conflicts: [{ conflictId: "registered.price", kind: "CONTRADICTORY_VALUE_CHANGE", target: { kind: "GLOBAL" }, scope: { coordinates: [{ kind: "GLOBAL" }] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: { registryRef: "domain.pricing", code: "adjust_price", version: "1" } }],
    });
    const refs = [first, second, target].map((action) => ({ entityKind: "ACTION" as const, actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) }));
    const result = assessPortfolioCompatibility(refs, { evaluatedAt, evaluationBoundary: boundary, horizonEnd: "2026-10-20T13:00:00Z", registry: [first, second, target].map((action) => ({ entityKind: "ACTION" as const, action })), timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] });
    expect(result.reasonCodes).not.toContain("AMBIGUOUS_CONFLICT_REGISTRY");
    expect(result.validity).toBe("VALID");
  });

  it.each([undefined, null, {}, { registry: null }])("returns deterministic invalid output for malformed context %#", (context) => {
    const result = assessPortfolioCompatibility([], context as any);
    expect(result).toMatchObject({ validity: "INVALID", status: "UNKNOWN", reasonCodes: ["INVALID_COMPATIBILITY_CONTEXT"] });
    expect(() => assessPortfolioCompatibility([], context as any)).not.toThrow();
    expect(assessPortfolioCompatibility([], context as any)).toEqual(result);
  });

  it.each([undefined, null, {}, 42, "action"])("returns deterministic invalid output for malformed portfolio container %#", (portfolio) => {
    const result = assessPortfolioCompatibility(portfolio as any, undefined);
    expect(result).toMatchObject({ evaluatedAt: "1970-01-01T00:00:00.000Z", validity: "INVALID", status: "UNKNOWN" });
    expect(() => assessPortfolioCompatibility(portfolio as any, undefined)).not.toThrow();
    expect(assessPortfolioCompatibility(portfolio as any, undefined)).toEqual(result);
  });

  it("rejects malformed horizons, caps, timing contexts, and evidence instead of throwing or dropping them", () => {
    const action = adaptLegacyAction(setSkuA849Cad), ref = { entityKind: "ACTION" as const, actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) };
    const valid = { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION" as const, action }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] };
    for (const context of [{ ...valid, horizonStart: "2026-10-02T00:00:00Z", horizonEnd: "2026-10-01T00:00:00Z" }, { ...valid, occurrenceSafetyCap: 0 }, { ...valid, timingContexts: { [action.actionId]: {} } }, { ...valid, priceBaselineReceipts: [{ receiptId: "bad" }] }]) {
      const result = assessPortfolioCompatibility([ref], context as any);
      expect(result.validity).toBe("INVALID");
      expect(result.status).toBe("UNKNOWN");
    }
  });
  it("implements the closed structural scope matrix and fails closed for evidence dimensions", () => {
    expect(assessScopeIntersection({ coordinates: [{ kind: "PRODUCT", productRef: "p" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "v" }] }, [])).toBe("INTERSECTS");
    expect(assessScopeIntersection({ coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "a" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "b" }] }, [])).toBe("DISJOINT");
    expect(assessScopeIntersection({ coordinates: [{ kind: "CHANNEL", channelRef: "email" }] }, { coordinates: [{ kind: "PLACEMENT", channelRef: "email", placementRef: "hero" }] }, [])).toBe("INTERSECTS");
    expect(assessScopeIntersection({ coordinates: [{ kind: "RESOURCE", resourceRef: "budget", unit: "CAD_MINOR" }] }, { coordinates: [{ kind: "RESOURCE", resourceRef: "budget", unit: "USD_MINOR" }] }, [])).toBe("UNKNOWN");
    expect(assessScopeIntersection({ coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "ca", version: "1" }] }, { coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "on", version: "1" }] }, [])).toBe("UNKNOWN");
    const malformedBinding = { pairKey: "ACTION:action_a:fnv1a64:aaaaaaaaaaaaaaaa|ACTION:action_b:fnv1a64:bbbbbbbbbbbbbbbb", evaluationBoundary: boundary, evaluatedAt };
    expect(() => assessScopeIntersection({ coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "ca", version: "1" }] }, { coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "on", version: "1" }] }, [null] as any, malformedBinding)).not.toThrow();
    expect(assessScopeIntersection({ coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "ca", version: "1" }] }, { coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "on", version: "1" }] }, [null] as any, malformedBinding)).toBe("UNKNOWN");
    expect(assessScopeIntersection({ coordinates: [{ kind: "PRODUCT", productRef: "p" }, { kind: "CHANNEL", channelRef: "email" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "v" }, { kind: "PLACEMENT", channelRef: "sms", placementRef: "hero" }] }, [])).toBe("DISJOINT");
    expect(assessScopeIntersection({ coordinates: [{ kind: "PRODUCT", productRef: "p" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "v" }, { kind: "CHANNEL", channelRef: "email" }] }, [])).toBe("INTERSECTS");
    expect(assessScopeIntersection({ coordinates: [{ kind: "PRODUCT", productRef: "p" }, { kind: "RESOURCE", resourceRef: "budget", unit: "CAD_MINOR" }] }, { coordinates: [{ kind: "PRODUCT", productRef: "p" }, { kind: "RESOURCE", resourceRef: "budget", unit: "USD_MINOR" }] }, [])).toBe("UNKNOWN");
  });

  it("is symmetric and finds an explicit price conflict on half-open overlapping time", () => {
    const left = adaptLegacyAction(setSkuA849Cad);
    const right = adaptLegacyAction(setSkuA949EffectiveOctober1);
    const rightFingerprint = fingerprintCanonicalAction(right);
    const context = { evaluatedAt, evaluationBoundary: boundary, horizonEnd: "2026-10-20T13:00:00Z", registry: [{ entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] };
    const first = assessPortfolioCompatibility([{ entityKind: "ACTION", actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) }, { entityKind: "ACTION", actionId: right.actionId, actionFingerprint: rightFingerprint }], context);
    const second = assessPortfolioCompatibility([...first.expandedMembers].reverse(), context);
    expect(first.status).toBe("CONFLICTING");
    expect(first.pairs[0]?.status).toBe("CONFLICT");
    expect(first.pairs[0]?.relations).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("rejects repeated execution paths and treats adjacent half-open intervals as coexisting", () => {
    const action = adaptLegacyAction(setSkuA849Cad);
    const ref = { entityKind: "ACTION" as const, actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) };
    const duplicate = assessPortfolioCompatibility([ref, ref], { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] });
    expect(duplicate.validity).toBe("INVALID");
    expect(duplicate.reasonCodes).toContain("DUPLICATE_EXECUTION_PATH");
    const key = `ACTION:${action.actionId}:${ref.actionFingerprint}`;
    const alias = { aliasId: "alias.shared.execution", registryRef: "execution.alias", code: "shared", version: "1", entity: ref, originPaths: [`portfolio:${key}#0`, `portfolio:${key}#1`], sourceRef: "alias.registry", provenance: ["alias.contract"] };
    const accepted = assessPortfolioCompatibility([ref, ref], { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [], executionAliases: [alias] });
    expect(accepted.validity).toBe("VALID");
    expect(accepted.evidenceRefs).toEqual(["alias.contract", "alias.registry", "alias.shared.execution"]);
    expect(assessPortfolioCompatibility([ref, ref], { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [], executionAliases: [alias, { ...alias, aliasId: "alias.duplicate" }] }).validity).toBe("INVALID");
  });

  it("distinguishes requested overlap from half-open effective adjacency", () => {
    const absolute = (at: string) => ({ state: "SPECIFIED" as const, value: { kind: "ABSOLUTE" as const, time: { kind: "UTC" as const, at: at as any, timeZone: "UTC" } } });
    const base = createCanonicalFixtures()[25]!.action!;
    const right = canonicalActionSchema.parse({ ...base, actionId: "action_price_right", timing: { ...base.timing, requestedStart: absolute("2026-09-20T14:00:00Z"), effectiveStart: absolute("2026-09-20T16:00:00Z"), implementationDelay: { state: "SPECIFIED", value: { kind: "ELAPSED", amount: 2, unit: "HOUR" } }, duration: { state: "SPECIFIED", value: { kind: "ELAPSED", amount: 1, unit: "HOUR", anchor: "EFFECTIVE_START" } }, end: { state: "SPECIFIED", value: { kind: "DERIVE_FROM_DURATION" } } } });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const build = (overlapRule: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP") => canonicalActionSchema.parse({ ...base, actionId: `action_price_left_${overlapRule.toLowerCase()}`, timing: { ...base.timing, requestedStart: absolute("2026-09-20T13:00:00Z"), effectiveStart: absolute("2026-09-20T15:00:00Z"), implementationDelay: { state: "SPECIFIED", value: { kind: "ELAPSED", amount: 2, unit: "HOUR" } }, duration: { state: "SPECIFIED", value: { kind: "ELAPSED", amount: 1, unit: "HOUR", anchor: "EFFECTIVE_START" } }, end: { state: "SPECIFIED", value: { kind: "DERIVE_FROM_DURATION" } } }, conflicts: [{ conflictId: "price.window", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "SKU", ref: "sku:A" }, scope: { coordinates: [{ kind: "VARIANT", productRef: "product:A", variantRef: "sku:A" }] }, overlapRule, counterparty: rightRef }] });
    for (const [mode, expected] of [["ANY_OVERLAP", "CONFLICTING"], ["EFFECTIVE_OVERLAP", "COMPATIBLE"]] as const) {
      const left = build(mode), leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
      const result = assessPortfolioCompatibility([leftRef, rightRef], { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action: left }, { entityKind: "ACTION", action: right }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] });
      expect(result.status).toBe(expected);
      if (mode === "ANY_OVERLAP") {
        expect(result.pairs[0]?.temporal?.mode).toBe("ANY_OVERLAP");
        expect(result.pairs[0]?.temporal?.leftOccurrences[0]).toMatchObject({ occurrenceIndex: 0, originalStart: "2026-09-20T13:00:00.000Z", comparisonStart: "2026-09-20T13:00:00.000Z" });
      }
    }
    const contradictory = canonicalActionSchema.parse({ ...build("ANY_OVERLAP"), actionId: "action_price_left_contradictory", conflicts: [...build("ANY_OVERLAP").conflicts, { ...build("ANY_OVERLAP").conflicts[0]!, conflictId: "price.window.effective", overlapRule: "EFFECTIVE_OVERLAP" }] });
    const contradictoryRef = { entityKind: "ACTION" as const, actionId: contradictory.actionId, actionFingerprint: fingerprintCanonicalAction(contradictory) };
    const contradiction = assessPortfolioCompatibility([contradictoryRef, rightRef], { evaluatedAt, evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action: contradictory }, { entityKind: "ACTION", action: right }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] });
    expect(contradiction.pairs[0]?.reasonCodes).toContain("CONTRADICTORY_CONFLICT_DECLARATIONS");
  });

  it("expands experiment arms with origin diagnostics and still checks shared writes", () => {
    const timing = createCanonicalFixtures()[25]!.action!.timing;
    const treatment = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_arm_treatment", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing, provenance: ["evidence.arm"] });
    const treatmentRef = { entityKind: "ACTION" as const, actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment) };
    const control = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_arm_control", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing, conflicts: [{ conflictId: "shared.write", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "GLOBAL" }, scope: { coordinates: [{ kind: "GLOBAL" }] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: treatmentRef }], provenance: ["evidence.arm"] });
    const fixturePopulation = createCanonicalFixtures()[0]!.action!.population!;
    const experiment = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_experiment_conflict", population: fixturePopulation, timing, provenance: ["evidence.experiment"], what: { actionType: "experiment.run", hypothesisRef: "hypothesis.shared_write", primaryMetricRef: "metric.conversion", randomizationUnit: "CUSTOMER", assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, arms: [{ armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 }, { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: treatmentRef.actionFingerprint, allocationBasisPoints: 5000 }], stopping: { kind: "FIXED", sampleTarget: 100 }, measurementWindow: { start: "2026-09-22T14:00:00Z", end: "2026-09-29T14:00:00Z" } } });
    const experimentRef = { entityKind: "ACTION" as const, actionId: experiment.actionId, actionFingerprint: fingerprintCanonicalAction(experiment) };
    const result = assessPortfolioCompatibility([experimentRef], { evaluatedAt: "2026-09-22T14:00:00Z", evaluationBoundary: boundary, registry: [{ entityKind: "ACTION", action: experiment }, { entityKind: "ACTION", action: control }, { entityKind: "ACTION", action: treatment }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] });
    expect(result.status).toBe("CONFLICTING");
    expect(result.pairs[0]?.left.armId).toBeDefined();
    expect(result.pairs[0]?.right.originPath).toContain("experiment:action_experiment_conflict");
  });

  it("requires one exactly bound partition receipt before population-scoped arms coexist", () => {
    const timing = createCanonicalFixtures()[25]!.action!.timing, population = createCanonicalFixtures()[0]!.action!.population!;
    const coordinate = { kind: "POPULATION" as const, populationId: population.populationId, version: population.version, definitionFingerprint: population.definitionFingerprint, binding: population.binding, membershipMode: population.membershipMode };
    const right = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_population_arm_right", what: { actionType: "no_op.do_nothing", scope: { kind: "POPULATION" } }, population, timing, provenance: ["evidence.arm"] });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const left = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_population_arm_left", what: { actionType: "no_op.do_nothing", scope: { kind: "POPULATION" } }, population, timing, conflicts: [{ conflictId: "population.write", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "POPULATION", ref: population.populationId }, scope: { coordinates: [coordinate] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: rightRef }], provenance: ["evidence.arm"] });
    const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
    const experiment = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_population_experiment", population, timing, provenance: ["evidence.experiment"], what: { actionType: "experiment.run", hypothesisRef: "hypothesis.population", primaryMetricRef: "metric.conversion", randomizationUnit: "CUSTOMER", assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, arms: [{ armId: "arm_left", role: "CONTROL", actionId: left.actionId, actionFingerprint: leftRef.actionFingerprint, allocationBasisPoints: 5000 }, { armId: "arm_right", role: "TREATMENT", actionId: right.actionId, actionFingerprint: rightRef.actionFingerprint, allocationBasisPoints: 5000 }], stopping: { kind: "FIXED", sampleTarget: 100 }, measurementWindow: { start: "2026-09-22T14:00:00Z", end: "2026-09-29T14:00:00Z" } } });
    const experimentRef = { entityKind: "ACTION" as const, actionId: experiment.actionId, actionFingerprint: fingerprintCanonicalAction(experiment) };
    const context = { evaluatedAt: "2026-09-22T14:00:00Z", evaluationBoundary: boundary, registry: [{ entityKind: "ACTION" as const, action: experiment }, { entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [] };
    expect(assessPortfolioCompatibility([experimentRef], { ...context, partitionReceipts: [] }).status).toBe("UNKNOWN");
    const key = [`ACTION:${left.actionId}:${leftRef.actionFingerprint}`, `ACTION:${right.actionId}:${rightRef.actionFingerprint}`].sort().join("|");
    const receipt = { receiptId: "receipt.partition", experimentActionId: experiment.actionId, experimentActionFingerprint: experimentRef.actionFingerprint, populationId: population.populationId, populationVersion: population.version, populationFingerprint: population.definitionFingerprint, populationBinding: population.binding, assignmentBoundary: "USE_ENVELOPE_POPULATION_BINDING" as const, leftArmId: "arm_left", rightArmId: "arm_right", pairKey: key, evaluationBoundary: boundary, observedAt: "2026-09-22T14:00:00Z", windowStart: "2026-09-22T00:00:00Z", windowEnd: "2026-09-30T00:00:00Z", leftOccurrenceIndexes: [0], rightOccurrenceIndexes: [0], disjoint: true, sourceRef: "assignment.partition", provenance: ["assignment.snapshot"] };
    const coexist = assessPortfolioCompatibility([experimentRef], { ...context, partitionReceipts: [receipt] });
    expect(coexist.status).toBe("COMPATIBLE");
    expect(coexist.evidenceRefs).toEqual(["assignment.partition", "assignment.snapshot", "receipt.partition"]);
    expect(assessPortfolioCompatibility([experimentRef], { ...context, partitionReceipts: [receipt, { ...receipt, receiptId: "receipt.partition.duplicate" }] }).status).toBe("UNKNOWN");
    expect(assessPortfolioCompatibility([experimentRef], { ...context, partitionReceipts: [{ ...receipt, experimentActionFingerprint: "fnv1a64:aaaaaaaaaaaaaaaa" }] }).status).toBe("UNKNOWN");
  });

  it("binds custom scope evidence exactly and treats stale or duplicate matches as unknown", () => {
    const timing = createCanonicalFixtures()[25]!.action!.timing, scope = { coordinates: [{ kind: "CUSTOM" as const, registryRef: "market.region", code: "ca", version: "1" }] };
    const right = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_custom_right", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing, provenance: ["evidence.action"] });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const left = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_custom_left", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing, conflicts: [{ conflictId: "custom.region", kind: "CUSTOM", target: { kind: "GLOBAL" }, scope, overlapRule: "EFFECTIVE_OVERLAP", counterparty: rightRef }], provenance: ["evidence.action"] });
    const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) }, key = [`ACTION:${left.actionId}:${leftRef.actionFingerprint}`, `ACTION:${right.actionId}:${rightRef.actionFingerprint}`].sort().join("|");
    const receipt = { receiptId: "receipt.scope", pairKey: key, leftScopeFingerprint: fingerprintConflictScope(scope), rightScopeFingerprint: fingerprintConflictScope(scope), evaluationBoundary: boundary, observedAt: "2026-09-22T13:59:00Z", sourceRef: "scope.registry", provenance: ["scope.snapshot"], intersection: "INTERSECTS" as const };
    const context = { evaluatedAt: "2026-09-22T14:00:00Z", evaluationBoundary: boundary, maximumAgeSeconds: 300, registry: [{ entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], timingContexts: {}, priceBaselineReceipts: [], partitionReceipts: [] };
    const conflict = assessPortfolioCompatibility([leftRef, rightRef], { ...context, scopeIntersectionReceipts: [receipt] });
    expect(conflict.status).toBe("CONFLICTING");
    expect(conflict.evidenceRefs).toEqual(["receipt.scope", "scope.registry", "scope.snapshot"]);
    expect(assessPortfolioCompatibility([rightRef, leftRef], { ...context, scopeIntersectionReceipts: [receipt] })).toEqual(conflict);
    expect(assessPortfolioCompatibility([leftRef, rightRef], { ...context, maximumAgeSeconds: 30, scopeIntersectionReceipts: [receipt] }).status).toBe("UNKNOWN");
    expect(assessPortfolioCompatibility([leftRef, rightRef], { ...context, scopeIntersectionReceipts: [receipt, { ...receipt, receiptId: "receipt.scope.other" }] }).status).toBe("UNKNOWN");
  });

  it("fails closed for open recurrence without a horizon and retains occurrence indexes with one", () => {
    const recurring = createCanonicalFixtures()[26]!.action!;
    const openTiming = { ...recurring.timing, recurrence: { state: "SPECIFIED" as const, value: { ...((recurring.timing.recurrence as any).value), boundary: { kind: "OPEN_ENDED" as const, explicitlyOpenEnded: true } } } };
    const right = canonicalActionSchema.parse({ ...recurring, actionId: "action_recurring_right", timing: openTiming });
    const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const left = canonicalActionSchema.parse({ ...recurring, actionId: "action_recurring_left", timing: openTiming, conflicts: [{ conflictId: "recurrence.shared", kind: "MUTUALLY_EXCLUSIVE_INTENT", target: { kind: "GLOBAL" }, scope: { coordinates: [{ kind: "GLOBAL" }] }, overlapRule: "EFFECTIVE_OVERLAP", counterparty: rightRef }] });
    const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
    const context = { evaluatedAt: "2026-09-22T14:00:00Z", evaluationBoundary: boundary, registry: [{ entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] };
    expect(assessPortfolioCompatibility([leftRef, rightRef], context).status).toBe("UNKNOWN");
    const bounded = assessPortfolioCompatibility([leftRef, rightRef], { ...context, horizonStart: "2026-09-22T00:00:00Z", horizonEnd: "2026-10-20T00:00:00Z" });
    expect(bounded.status).toBe("CONFLICTING");
    expect(bounded.pairs[0]?.temporal?.leftOccurrences.map((item) => item.occurrenceIndex)).toEqual([0, 1, 2, 3]);
    expect(assessPortfolioCompatibility([leftRef, rightRef], { ...context, horizonEnd: "2026-10-20T00:00:00Z", occurrenceSafetyCap: 2 }).status).toBe("UNKNOWN");
  });
});
