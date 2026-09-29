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
    expect(result.burdens).toEqual(expect.arrayContaining([expect.objectContaining({ burdenId: "a.hours", amount: { state: "KNOWN", quantity: 2 } }), expect.objectContaining({ burdenId: "b.hours", amount: { state: "KNOWN", quantity: 3 } })]));
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
  });
});
