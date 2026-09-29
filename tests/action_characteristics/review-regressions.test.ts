import { describe, expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { aggregateActionCharacteristics, aggregateExperimentCharacteristics, validateActionCharacteristics } from "../../src/action_characteristics/index.js";

const base = createCanonicalFixtures().find((fixture) => fixture.action)!.action!;
const chars = { state: "PRESENT" as const, value: { implementationCost: [], reversibility: { kind: "NOT_APPLICABLE" as const, reason: "none" }, cancellationCosts: [], operationalBurden: [] } };
const action = (id: string, implementationDelay: any) => ({ ...base, actionId: id, timing: { ...base.timing, implementationDelay }, characteristics: chars });

describe("characteristics review regressions", () => {
  it("returns deterministic invalid results instead of throwing on malformed public inputs", () => {
    expect(() => aggregateActionCharacteristics(null as any, null as any)).not.toThrow();
    expect(aggregateActionCharacteristics(null as any, null as any).status).toBe("INVALID");
    expect(() => validateActionCharacteristics(null as any, { actions: [null as any] })).not.toThrow();
    expect(validateActionCharacteristics(null as any, { actions: [null as any] }).status).toBe("INVALID");
    expect(() => aggregateExperimentCharacteristics(null as any, null as any)).not.toThrow();
    expect(aggregateExperimentCharacteristics(null as any, null as any).status).toBe("INVALID");
    expect(aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_bad", executionPolicy: "PARALLEL", members: [{ componentId: "x", node: null }] } as any).status).toBe("INVALID");
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: base }, { aliases: [{ aliasContractRef: "x", version: "1", actionId: base.actionId, actionFingerprint: "bad", paths: ["a", "b"] }] }).issues).toContain("INVALID_ALIAS_CONTEXT");
  });

  it("treats ABSENT delay as zero and calendar delays as unresolved without exact context", () => {
    const absent = action("action_absent", { state: "ABSENT", reason: "none" });
    const calendar = action("action_calendar", { state: "SPECIFIED", value: { kind: "CALENDAR", amount: 1, unit: "DAY" } });
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: absent }).derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 0 });
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: calendar }).derivedCriticalPathDelay.state).toBe("UNKNOWN");
    const anchor = (target: any, start: string, observedAt = "2026-03-01T00:00:00Z") => ({ anchorId: `anchor.${target.actionId}`, actionId: target.actionId, actionFingerprint: fingerprintCanonicalAction(target), start, timeZone: "America/Toronto", boundary: "IMPLEMENTATION_DELAY_START" as const, observedAt, source: "calendar.scheduler", provenance: ["receipt.scheduler"] });
    const resolved = aggregateActionCharacteristics({ kind: "ACTION", action: calendar }, { calendarAnchors: [anchor(calendar, "2026-03-08T05:00:00Z")] });
    expect(resolved.derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 82_800 });
    const month = action("action_month", { state: "SPECIFIED", value: { kind: "CALENDAR", amount: 1, unit: "MONTH" } });
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: month }, { calendarAnchors: [anchor(month, "2026-02-01T05:00:00Z")] }).derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 2_419_200 });
    const changedEvidence = aggregateActionCharacteristics({ kind: "ACTION", action: calendar }, { calendarAnchors: [anchor(calendar, "2026-03-08T05:00:00Z", "2026-03-02T00:00:00Z")] });
    expect(changedEvidence.derivedCriticalPathDelay).toEqual(resolved.derivedCriticalPathDelay);
    expect(changedEvidence.aggregateFingerprint).not.toBe(resolved.aggregateFingerprint);
    expect(resolved.audit.calendarAnchors[0]).toMatchObject({ anchorId: `anchor.${calendar.actionId}`, actionFingerprint: fingerprintCanonicalAction(calendar) });
  });

  it("rejects duplicate component IDs, dangling dependencies, and same ID with different semantics", () => {
    const a = action("action_same", { state: "ABSENT" });
    const b = { ...a, timing: { ...a.timing, implementationDelay: { state: "SPECIFIED" as const, value: { kind: "ELAPSED" as const, amount: 1, unit: "HOUR" as const } } } };
    const result = aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_bad", executionPolicy: "DEPENDENCY_GATED", members: [{ componentId: "x", dependsOn: ["missing"], node: { kind: "ACTION", action: a } }, { componentId: "x", node: { kind: "ACTION", action: b } }] });
    expect(result.status).toBe("INVALID");
    expect(result.issues).toEqual(expect.arrayContaining(["DUPLICATE_COMPONENT_ID", "UNKNOWN_DEPENDENCY_MEMBER", "ACTION_ID_FINGERPRINT_CONFLICT"]));
  });

  it("derives a diamond critical path without double counting shared predecessors", () => {
    const leaf = (id: string, hours: number) => ({ kind: "ACTION" as const, action: action(id, { state: "SPECIFIED", value: { kind: "ELAPSED", amount: hours, unit: "HOUR" } }) });
    const result = aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_diamond", executionPolicy: "DEPENDENCY_GATED", members: [
      { componentId: "a", node: leaf("action_diamond_a", 1) },
      { componentId: "b", dependsOn: ["a"], node: leaf("action_diamond_b", 2) },
      { componentId: "c", dependsOn: ["a"], node: leaf("action_diamond_c", 3) },
      { componentId: "d", dependsOn: ["b", "c"], node: leaf("action_diamond_d", 4) },
    ] });
    expect(result.derivedCriticalPathDelay).toEqual({ state: "KNOWN", seconds: 28_800 });
  });

  it("separates burden phases and produces order-stable aggregate fingerprints with audit origins", () => {
    const burden = { burdenId: "burden.ops", amount: { state: "UNKNOWN" as const, reason: "pending" } };
    const a = { ...action("action_audit_a", { state: "ABSENT" }), characteristics: { state: "PRESENT" as const, value: { ...chars.value, operationalBurden: [burden], cancellationCosts: [{ stage: "BEFORE_START" as const, cancellationAvailable: true, cancellationCost: [], compensationCost: [], operationalBurden: [burden] }] } } };
    const b = action("action_audit_b", { state: "ABSENT" });
    const make = (members: any[]) => aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_audit", executionPolicy: "PARALLEL", members });
    const left = make([{ componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", node: { kind: "ACTION", action: b } }]);
    const right = make([{ componentId: "b", node: { kind: "ACTION", action: b } }, { componentId: "a", node: { kind: "ACTION", action: a } }]);
    expect(left.burdens.map((entry) => [entry.phase, entry.stage])).toEqual(expect.arrayContaining([["IMPLEMENTATION", undefined], ["CANCELLATION", "BEFORE_START"]]));
    expect(left.aggregateFingerprint).toBe(right.aggregateFingerprint);
    expect(left.audit.members.map((entry) => entry.actionId)).toEqual(["action_audit_a", "action_audit_b"]);
  });

  it("keeps distinct burden IDs as deterministic buckets across member reorderings", () => {
    const burden = (burdenId: string) => ({ burdenId, amount: { state: "KNOWN" as const, value: { quantity: 1, unit: "hours" as const, resource: { kind: "STAFF" as const, resourceRef: "team.ops" } } } });
    const withBurden = (id: string, burdenId: string) => ({ ...action(id, { state: "ABSENT" }), characteristics: { state: "PRESENT" as const, value: { ...chars.value, operationalBurden: [burden(burdenId)] } } });
    const a = withBurden("action_burden_a", "burden.a"), b = withBurden("action_burden_b", "burden.b");
    const aggregate = (members: any[]) => aggregateActionCharacteristics({ kind: "COMPOUND", compoundId: "compound_burdens", executionPolicy: "PARALLEL", members });
    const left = aggregate([{ componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", node: { kind: "ACTION", action: b } }]);
    const right = aggregate([{ componentId: "b", node: { kind: "ACTION", action: b } }, { componentId: "a", node: { kind: "ACTION", action: a } }]);
    expect(left.burdens.map(({ burdenId }) => burdenId)).toEqual(["burden.a", "burden.b"]);
    expect(left.aggregateFingerprint).toBe(right.aggregateFingerprint);
  });

  it("audits only aliases consumed by exact duplicate paths", () => {
    const shared = action("action_alias_shared", { state: "ABSENT" });
    const node: any = { kind: "COMPOUND", compoundId: "compound_alias", executionPolicy: "PARALLEL", members: [{ componentId: "a", node: { kind: "ACTION", action: shared } }, { componentId: "b", node: { kind: "ACTION", action: shared } }] };
    const used = { aliasContractRef: "alias.used", version: "1", actionId: shared.actionId, actionFingerprint: fingerprintCanonicalAction(shared), paths: ["compound_alias/a", "compound_alias/b"] };
    const unrelated = { aliasContractRef: "alias.unrelated", version: "1", actionId: "action_other", actionFingerprint: "fnv1a64:0000000000000000", paths: ["x", "y"] };
    const plain = aggregateActionCharacteristics(node, { aliases: [used] });
    const extra = aggregateActionCharacteristics(node, { aliases: [unrelated, used] });
    expect(extra.audit.aliases).toEqual([used]);
    expect(extra.aggregateFingerprint).toBe(plain.aggregateFingerprint);
    const sameContractButUnused = { ...unrelated, aliasContractRef: used.aliasContractRef };
    const collidingUnused = aggregateActionCharacteristics(node, { aliases: [sameContractButUnused, used] });
    expect(collidingUnused.audit.aliases).toEqual([used]);
    expect(collidingUnused.aggregateFingerprint).toBe(plain.aggregateFingerprint);
  });

  it("strictly validates calendar-anchor evidence", () => {
    const calendar = action("action_calendar_strict", { state: "SPECIFIED", value: { kind: "CALENDAR", amount: 1, unit: "DAY" } });
    const anchor = { anchorId: "anchor.calendar", actionId: calendar.actionId, actionFingerprint: fingerprintCanonicalAction(calendar), start: "2026-03-08T05:00:00Z", timeZone: "America/Toronto", boundary: "IMPLEMENTATION_DELAY_START" as const, observedAt: "2026-03-01T00:00:00Z", source: "calendar.scheduler", provenance: ["receipt.scheduler"] };
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: calendar }, { calendarAnchors: [{ ...anchor, extra: true } as any] }).issues).toEqual(["INVALID_CALENDAR_CONTEXT"]);
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: calendar }, { calendarAnchors: [{ ...anchor, provenance: ["receipt.scheduler", "receipt.scheduler"] }] }).issues).toEqual(["INVALID_CALENDAR_CONTEXT"]);
    expect(aggregateActionCharacteristics({ kind: "ACTION", action: calendar }, { calendarAnchors: [anchor, { ...anchor }] }).issues).toEqual(["DUPLICATE_CALENDAR_ANCHOR"]);
  });

  it("uses UNKNOWN for missing experiment arms and INVALID for ambiguous registries", () => {
    const experiment = { ...base, what: { actionType: "experiment.run", hypothesisRef: "hypothesis.x", primaryMetricRef: "metric.x", randomizationUnit: "CUSTOMER", assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, stopping: { kind: "FIXED", sampleTarget: 10 }, measurementWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" }, arms: [{ armId: "arm_a", role: "CONTROL", actionId: "action_a", actionFingerprint: "fnv1a64:0000000000000001", allocationBasisPoints: 5000 }, { armId: "arm_b", role: "TREATMENT", actionId: "action_b", actionFingerprint: "fnv1a64:0000000000000002", allocationBasisPoints: 5000 }] } } as any;
    expect(aggregateExperimentCharacteristics(experiment, {}).status).toBe("UNKNOWN");
    const duplicate = action("action_a", { state: "ABSENT" });
    expect(aggregateExperimentCharacteristics(experiment, { actions: [duplicate, duplicate] }).status).toBe("INVALID");
  });
});
