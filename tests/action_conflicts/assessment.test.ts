import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { increaseSkuA50Cad, setSkuA849Cad } from "../../src/pricing/fixtures.js";
import { assessPortfolioCompatibility, assessScopeIntersection } from "../../src/action_conflicts/index.js";

const evaluatedAt = "2026-09-20T13:00:00Z";
const boundary = "DECISION_TIME" as const;

describe("portfolio compatibility assessment", () => {
  it("implements the closed structural scope matrix and fails closed for evidence dimensions", () => {
    expect(assessScopeIntersection({ coordinates: [{ kind: "PRODUCT", productRef: "p" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "v" }] }, [])).toBe("INTERSECTS");
    expect(assessScopeIntersection({ coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "a" }] }, { coordinates: [{ kind: "VARIANT", productRef: "p", variantRef: "b" }] }, [])).toBe("DISJOINT");
    expect(assessScopeIntersection({ coordinates: [{ kind: "CHANNEL", channelRef: "email" }] }, { coordinates: [{ kind: "PLACEMENT", channelRef: "email", placementRef: "hero" }] }, [])).toBe("INTERSECTS");
    expect(assessScopeIntersection({ coordinates: [{ kind: "RESOURCE", resourceRef: "budget", unit: "CAD_MINOR" }] }, { coordinates: [{ kind: "RESOURCE", resourceRef: "budget", unit: "USD_MINOR" }] }, [])).toBe("UNKNOWN");
    expect(assessScopeIntersection({ coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "ca", version: "1" }] }, { coordinates: [{ kind: "CUSTOM", registryRef: "geo", code: "on", version: "1" }] }, [])).toBe("UNKNOWN");
  });

  it("is symmetric and finds an explicit price conflict on half-open overlapping time", () => {
    const left = adaptLegacyAction(setSkuA849Cad);
    const right = adaptLegacyAction(increaseSkuA50Cad);
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
