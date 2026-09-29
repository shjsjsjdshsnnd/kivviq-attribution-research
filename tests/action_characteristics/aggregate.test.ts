import { describe, expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { aggregateActionCharacteristics, aggregateCompoundCharacteristics, aggregateExperimentCharacteristics, type CharacteristicAggregateNode } from "../../src/action_characteristics/index.js";
import { createCompoundFixtures } from "../../src/compound_action/fixtures.js";

const base = createCanonicalFixtures().find((f) => f.action)!.action!;
const action = (id: string, delay: any, implementationCost: any[], burden: any[], reversibility: any = { kind: "NOT_APPLICABLE", reason: "none" }) => ({ ...base, actionId: id, timing: { ...base.timing, implementationDelay: delay }, characteristics: { state: "PRESENT" as const, value: { implementationCost, reversibility, cancellationCosts: [], operationalBurden: burden } } });
const knownCost = (id: string, category: "MEDIA" | "LABOR", amountMinor: number, currency: string) => ({ lineItemId: id, category, amount: { state: "KNOWN" as const, value: { amountMinor, currency } } });
const rangeCost = (id: string, category: "MEDIA" | "LABOR", min: number, max: number, currency = "USD") => ({ lineItemId: id, category, amount: { state: "RANGE" as const, minimum: { amountMinor: min, currency }, maximum: { amountMinor: max, currency } } });
const burden = (id: string, quantity: number) => ({ burdenId: id, amount: { state: "KNOWN" as const, value: { quantity, unit: "hours" as const, resource: { kind: "STAFF" as const, resourceRef: "team.ops" } } } });
const elapsed = (amount: number) => ({ state: "SPECIFIED" as const, value: { kind: "ELAPSED" as const, amount, unit: "HOUR" as const } });

describe("action characteristic vectors", () => {
  it("sums compatible cost and burden buckets while preserving currencies and unknown/N/A", () => {
    const a = action("action_a", elapsed(2), [knownCost("a.usd", "MEDIA", 100, "USD"), rangeCost("a.range", "LABOR", 10, 20), { lineItemId: "a.unknown", category: "MEDIA", amount: { state: "UNKNOWN", reason: "invoice pending" } }], [burden("a.hours", 2)]);
    const b = action("action_b", elapsed(3), [knownCost("b.usd", "MEDIA", 50, "USD"), knownCost("b.cad", "MEDIA", 70, "CAD"), rangeCost("b.range", "LABOR", 5, 7), { lineItemId: "b.na", category: "MEDIA", amount: { state: "NOT_APPLICABLE", reason: "owned channel" } }], [burden("b.hours", 3)]);
    const result = aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_x", executionPolicy: "ORDERED", members: [{ componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", dependsOn: ["a"], node: { kind: "ACTION", action: b } }] });
    expect(result.status).toBe("VALID");
    expect(result.costs).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "MEDIA", currency: null, amount: { state: "UNKNOWN", reasons: ["invoice pending"] } }),
      expect.objectContaining({ category: "MEDIA", currency: "USD", amount: { state: "KNOWN", amountMinor: 150 } }),
      expect.objectContaining({ category: "MEDIA", currency: "CAD", amount: { state: "KNOWN", amountMinor: 70 } }),
      expect.objectContaining({ category: "LABOR", currency: "USD", amount: { state: "RANGE", minimumMinor: 15, maximumMinor: 27 } }),
    ]));
    expect(result.costs).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "MEDIA", currency: null, amount: { state: "NOT_APPLICABLE", reasons: ["owned channel"] } }),
    ]));
    expect(result.burdens).toEqual([expect.objectContaining({ contributingBurdenIds: ["a.hours", "b.hours"], amount: { state: "KNOWN", quantity: 5 } })]);
    expect(result.burdens[0]).toMatchObject({ resource: { kind: "STAFF", resourceRef: "team.ops" }, unit: "hours" });
    expect(result.declaredDelays).toHaveLength(2);
    expect(result.derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 18_000 });
  });

  it("retains parallel branches and reports reversibility components without rollback readiness", () => {
    const a = action("action_a", elapsed(2), [], [], { kind: "FULLY_REVERSIBLE", reversal: { kind: "REGISTERED", registryRef: "rollback.x", code: "restore", version: "1" } });
    const b = action("action_b", elapsed(5), [], [], { kind: "UNKNOWN", reason: "not assessed" });
    const result = aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_parallel", executionPolicy: "PARALLEL", members: [{ componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", node: { kind: "ACTION", action: b } }] });
    expect(result.parallelBranches).toHaveLength(2);
    expect(result.derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 18_000 });
    expect(result.reversibility.summary).toBe("UNKNOWN");
    expect(result).not.toHaveProperty("rollbackReady");
    expect(result).not.toHaveProperty("score");
  });

  it("rejects cycles and duplicate expansion paths unless an exact versioned alias authorizes sharing", () => {
    const shared = action("action_shared", elapsed(1), [knownCost("shared", "MEDIA", 25, "USD")], []);
    const duplicated: CharacteristicAggregateNode = { kind: "COMPOUND", compoundId: "compound_dup", executionPolicy: "PARALLEL", members: [{ componentId: "a", node: { kind: "ACTION", action: shared } }, { componentId: "b", node: { kind: "ACTION", action: shared } }] };
    expect(aggregateActionCharacteristics(duplicated).status).toBe("INVALID");
    const aliased = aggregateActionCharacteristics(duplicated, { aliases: [{ aliasContractRef: "aliases.shared", version: "1", actionId: shared.actionId, actionFingerprint: "fnv1a64:0000000000000000", paths: ["compound_dup/a", "compound_dup/b"] }] });
    expect(aliased.status).toBe("INVALID");
    const authorized = aggregateActionCharacteristics(duplicated, { aliases: [{ aliasContractRef: "aliases.shared", version: "1", actionId: shared.actionId, actionFingerprint: fingerprintCanonicalAction(shared), paths: ["compound_dup/a", "compound_dup/b"] }] });
    expect(authorized.status).toBe("VALID");
    expect(authorized.costs.find(({ currency }) => currency === "USD")?.amount).toEqual({ state: "KNOWN", amountMinor: 25 });
    expect(authorized.audit.members).toHaveLength(2);
    expect(authorized.declaredDelays).toHaveLength(2);
    const ordered = { ...duplicated, executionPolicy: "ORDERED" as const };
    expect(aggregateActionCharacteristics(ordered, { aliases: [{ aliasContractRef: "aliases.shared", version: "1", actionId: shared.actionId, actionFingerprint: fingerprintCanonicalAction(shared), paths: ["compound_dup/a", "compound_dup/b"] }] }).derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 3600 });
    const cyclic: any = { kind: "COMPOUND", compoundId: "compound_cycle", executionPolicy: "ORDERED", members: [] };
    cyclic.members.push({ componentId: "self", node: cyclic });
    expect(aggregateActionCharacteristics(cyclic).issues).toContain("EXPANSION_CYCLE");
  });

  it("uses safe arithmetic and rejects overflow", () => {
    const a = action("action_a", elapsed(1), [knownCost("a", "MEDIA", Number.MAX_SAFE_INTEGER, "USD")], []);
    const b = action("action_b", elapsed(1), [knownCost("b", "MEDIA", 1, "USD")], []);
    expect(aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_overflow", executionPolicy: "ORDERED", members: [{ componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", node: { kind: "ACTION", action: b } }] }).issues).toContain("UNSAFE_NUMERIC_AGGREGATE");
  });

  it("accepts the canonical compound shape directly", () => {
    const compound = createCompoundFixtures()[0]!.action;
    const members = compound.components.map((component, index) => ({ ...component, action: action(`action_direct_${index}`, elapsed(index + 1), [], []) }));
    const result = aggregateCompoundCharacteristics({ ...compound, components: members });
    expect(result.declaredDelays).toHaveLength(members.length);
    expect(result.status).toBe("VALID");
  });

  it("stratifies experiment arms and never sums alternative assignments", () => {
    const control = action("action_control", elapsed(1), [knownCost("control", "MEDIA", 10, "USD")], []);
    const treatment = action("action_treatment", elapsed(2), [knownCost("treatment", "MEDIA", 20, "USD")], []);
    const experiment: any = { ...base, actionId: "action_experiment_characteristics", characteristics: { state: "ABSENT" }, what: { actionType: "experiment.run", hypothesisRef: "hypothesis.checkout", primaryMetricRef: "metric.conversion", randomizationUnit: "CUSTOMER", assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, stopping: { kind: "FIXED", sampleTarget: 100 }, measurementWindow: { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" }, arms: [
      { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
      { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment), allocationBasisPoints: 5000 },
    ] } };
    const result = aggregateExperimentCharacteristics(experiment, { actions: [control, treatment] });
    expect(result.status).toBe("VALID");
    expect(result.arms).toHaveLength(2);
    expect(result.arms.map((arm) => arm.vector.costs[0]?.amount)).toEqual([{ state: "KNOWN", amountMinor: 10 }, { state: "KNOWN", amountMinor: 20 }]);
    expect(result).not.toHaveProperty("costs");
    expect(aggregateExperimentCharacteristics(experiment, { actions: [control, treatment], typo: true } as any).issues).toEqual(["INVALID_EXPERIMENT_REGISTRY"]);

    const calendarControl = { ...control, timing: { ...control.timing, implementationDelay: { state: "SPECIFIED" as const, value: { kind: "CALENDAR" as const, amount: 1, unit: "DAY" as const } } } };
    const calendarExperiment: any = { ...experiment, what: { ...experiment.what, arms: experiment.what.arms.map((arm: any) => arm.armId === "arm_control" ? { ...arm, actionFingerprint: fingerprintCanonicalAction(calendarControl) } : arm) } };
    const calendarResult = aggregateExperimentCharacteristics(calendarExperiment, {
      actions: [calendarControl, treatment], evaluatedAt: "2026-09-30T00:00:00Z", maximumAgeSeconds: 3600,
      calendarAnchors: [{ anchorId: "anchor.experiment.control", actionId: calendarControl.actionId, actionFingerprint: fingerprintCanonicalAction(calendarControl), start: "2026-10-01T00:00:00Z", timeZone: "UTC", boundary: "IMPLEMENTATION_DELAY_START", observedAt: "2026-09-29T23:30:00Z", source: "calendar.scheduler", provenance: ["receipt.scheduler"] }],
    });
    expect(calendarResult.status).toBe("VALID");
    expect(calendarResult.arms.find(({ armId }) => armId === "arm_control")?.vector.audit.calendarAnchors[0]).toMatchObject({ anchorId: "anchor.experiment.control", freshnessStatus: "ACCEPTED" });
    const baseAnchor = { anchorId: "anchor.experiment.control", actionId: calendarControl.actionId, actionFingerprint: fingerprintCanonicalAction(calendarControl), start: "2026-10-01T00:00:00Z", timeZone: "UTC", boundary: "IMPLEMENTATION_DELAY_START" as const, observedAt: "2026-09-29T23:30:00Z", source: "calendar.scheduler", provenance: ["receipt.scheduler"] };
    const withUnused = aggregateExperimentCharacteristics(calendarExperiment, { actions: [calendarControl, treatment], evaluatedAt: "2026-09-30T00:00:00Z", maximumAgeSeconds: 3600, calendarAnchors: [baseAnchor, { ...baseAnchor, anchorId: "anchor.experiment.unused", actionId: "action_unrelated" }] });
    expect(withUnused.status).toBe("INVALID");
    expect(withUnused.issues).toContain("UNUSED_CALENDAR_ANCHOR");
    const mistargeted = aggregateExperimentCharacteristics(calendarExperiment, { actions: [calendarControl, treatment], evaluatedAt: "2026-09-30T00:00:00Z", maximumAgeSeconds: 3600, calendarAnchors: [{ ...baseAnchor, actionFingerprint: "fnv1a64:0000000000000000" }] });
    expect(mistargeted.status).toBe("INVALID");
    expect(mistargeted.issues).toContain("UNUSED_CALENDAR_ANCHOR");
  });
});
