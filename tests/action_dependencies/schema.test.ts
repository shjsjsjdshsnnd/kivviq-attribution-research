import { describe, expect, it } from "vitest";
import {
  actionDependenciesSchema,
  actionDependencySchema,
  actionLifecycleEventSchema,
  canonicalEntityReferenceSchema,
  dependencyEvidenceReceiptSchema,
} from "../../src/action_dependencies/index.js";

const actionRef = {
  entityKind: "ACTION" as const,
  actionId: "action_inventory-buy",
  actionFingerprint: "fnv1a64:1111111111111111",
};

const compoundRef = {
  entityKind: "COMPOUND" as const,
  compoundActionId: "compound_launch",
  compoundFingerprint: "fnv1a64:2222222222222222",
};

const common = {
  dependencyId: "dependency.inventory",
  evaluationBoundary: "TRANSLATION_TIME" as const,
  whenUnknown: "BLOCKED" as const,
};

describe("action dependency definitions", () => {
  it("requires exact ACTION and COMPOUND identities", () => {
    expect(canonicalEntityReferenceSchema.parse(actionRef)).toEqual(actionRef);
    expect(canonicalEntityReferenceSchema.parse(compoundRef)).toEqual(compoundRef);
    expect(
      canonicalEntityReferenceSchema.safeParse({
        entityKind: "ACTION",
        actionId: actionRef.actionId,
      }).success,
    ).toBe(false);
    expect(
      canonicalEntityReferenceSchema.safeParse({
        ...compoundRef,
        actionFingerprint: actionRef.actionFingerprint,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed IDs and fingerprints in both reference branches", () => {
    expect(
      canonicalEntityReferenceSchema.safeParse({
        ...actionRef,
        actionId: "compound_inventory-buy",
      }).success,
    ).toBe(false);
    expect(
      canonicalEntityReferenceSchema.safeParse({
        ...actionRef,
        actionFingerprint: "sha256:not-a-canonical-fingerprint",
      }).success,
    ).toBe(false);
    expect(
      canonicalEntityReferenceSchema.safeParse({
        ...compoundRef,
        compoundActionId: "action_launch",
      }).success,
    ).toBe(false);
    expect(
      canonicalEntityReferenceSchema.safeParse({
        ...compoundRef,
        compoundFingerprint: "fnv1a64:xyz",
      }).success,
    ).toBe(false);
  });

  it("accepts all four dependency kinds with explicit boundaries and unknown policy", () => {
    const dependencies = [
      {
        ...common,
        kind: "ENTITY_LIFECYCLE",
        prerequisite: actionRef,
        requiredState: "COMPLETED",
      },
      {
        ...common,
        dependencyId: "dependency.margin",
        kind: "HARD_CONSTRAINT_GATE",
        constraintId: "constraint.margin",
        requiredStatus: "SATISFIED",
        whenUnknown: "UNKNOWN",
      },
      {
        ...common,
        dependencyId: "dependency.audience",
        kind: "ELIGIBILITY_CHECK_GATE",
        checkId: "domain.lifecycle.audience_available",
        requiredStatus: "SATISFIED",
      },
      {
        ...common,
        dependencyId: "dependency.traffic",
        kind: "EXPERIMENT_READINESS_GATE",
        requirement: "SUFFICIENT_ELIGIBLE_TRAFFIC",
      },
    ];

    expect(actionDependenciesSchema.parse(dependencies)).toEqual(dependencies);
  });

  it("rejects missing boundaries, invalid unknown policies, ELIGIBLE lifecycle state, and open objects", () => {
    const lifecycle = {
      ...common,
      kind: "ENTITY_LIFECYCLE",
      prerequisite: compoundRef,
      requiredState: "STARTED",
    };
    const { evaluationBoundary: _boundary, ...withoutBoundary } = lifecycle;

    expect(actionDependencySchema.safeParse(withoutBoundary).success).toBe(false);
    expect(actionDependencySchema.safeParse({ ...lifecycle, whenUnknown: "ALLOW" }).success).toBe(false);
    expect(actionDependencySchema.safeParse({ ...lifecycle, requiredState: "ELIGIBLE" }).success).toBe(false);
    expect(actionDependencySchema.safeParse({ ...lifecycle, description: "must happen first" }).success).toBe(false);
  });

  it("requires unique dependency IDs", () => {
    const dependency = {
      ...common,
      kind: "ENTITY_LIFECYCLE",
      prerequisite: actionRef,
      requiredState: "EFFECTIVE",
    };

    expect(actionDependenciesSchema.safeParse([dependency, dependency]).success).toBe(false);
  });

  it("leaves unresolved references and graph cycles to runtime assessment", () => {
    const first = {
      ...common,
      dependencyId: "dependency.a-to-b",
      kind: "ENTITY_LIFECYCLE",
      prerequisite: actionRef,
      requiredState: "STARTED",
    };
    const second = {
      ...common,
      dependencyId: "dependency.b-to-a",
      kind: "ENTITY_LIFECYCLE",
      prerequisite: {
        entityKind: "ACTION",
        actionId: "action_unknown-or-cyclic",
        actionFingerprint: "fnv1a64:3333333333333333",
      },
      requiredState: "COMPLETED",
    };

    expect(actionDependenciesSchema.safeParse([first, second]).success).toBe(true);
  });
});

describe("dependency evidence inputs", () => {
  const event = {
    eventId: "event.inventory.completed",
    subject: {
      kind: "ACTION" as const,
      actionId: actionRef.actionId,
      actionFingerprint: actionRef.actionFingerprint,
    },
    eventKind: "COMPLETED" as const,
    occurredAt: "2026-09-28T12:00:00Z",
    sourceRef: "event-store.production",
    provenance: ["provider-event:789"],
  };
  const receipt = {
    receiptId: "receipt.inventory",
    dependentActionId: "action_scale-ads",
    dependentActionFingerprint: "fnv1a64:4444444444444444",
    dependencyId: common.dependencyId,
    evaluationBoundary: common.evaluationBoundary,
    observedAt: "2026-09-28T12:01:00Z",
    evidenceRefs: [event.eventId],
    provenance: ["dependency-evaluator:v1"],
    fact: {
      kind: "ENTITY_LIFECYCLE" as const,
      prerequisite: actionRef,
      events: [event],
    },
  };

  it("carries raw ACTION lifecycle events", () => {
    expect(actionLifecycleEventSchema.parse(event)).toEqual(event);
    expect(dependencyEvidenceReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it("rejects lifecycle conclusions and compound-level events", () => {
    expect(dependencyEvidenceReceiptSchema.safeParse({ ...receipt, status: "SATISFIED" }).success).toBe(false);
    expect(
      dependencyEvidenceReceiptSchema.safeParse({
        ...receipt,
        fact: { ...receipt.fact, state: "COMPLETED" },
      }).success,
    ).toBe(false);
    expect(
      actionLifecycleEventSchema.safeParse({
        ...event,
        subject: {
          kind: "COMPOUND",
          compoundActionId: compoundRef.compoundActionId,
          compoundFingerprint: compoundRef.compoundFingerprint,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects asserted lifecycle states and non-UTC event times", () => {
    expect(actionLifecycleEventSchema.safeParse({ ...event, state: "COMPLETED" }).success).toBe(false);
    expect(actionLifecycleEventSchema.safeParse({ ...event, eventKind: "RESOLVED" }).success).toBe(false);
    expect(actionLifecycleEventSchema.safeParse({ ...event, occurredAt: "2026-09-28T08:00:00-04:00" }).success).toBe(false);
  });

  it("rejects duplicate evidence and provenance references", () => {
    expect(
      actionLifecycleEventSchema.safeParse({
        ...event,
        provenance: ["provider-event:789", "provider-event:789"],
      }).success,
    ).toBe(false);
    expect(
      dependencyEvidenceReceiptSchema.safeParse({
        ...receipt,
        evidenceRefs: [event.eventId, event.eventId],
      }).success,
    ).toBe(false);
    expect(
      dependencyEvidenceReceiptSchema.safeParse({
        ...receipt,
        provenance: ["dependency-evaluator:v1", "dependency-evaluator:v1"],
      }).success,
    ).toBe(false);
  });

  it("requires receipt observation time in UTC-Z form", () => {
    expect(
      dependencyEvidenceReceiptSchema.safeParse({
        ...receipt,
        observedAt: "not-a-time",
      }).success,
    ).toBe(false);
    expect(
      dependencyEvidenceReceiptSchema.safeParse({
        ...receipt,
        observedAt: "2026-09-28T08:01:00-04:00",
      }).success,
    ).toBe(false);
  });

  it("accepts raw gate-input pointers without asserted status", () => {
    const facts = [
      { kind: "CONSTRAINT_INPUT", constraintId: "constraint.inventory" },
      { kind: "ELIGIBILITY_INPUT", checkId: "domain.lifecycle.audience_available" },
      { kind: "EXPERIMENT_READINESS_INPUT", requirement: "READY" },
    ];
    for (const [index, fact] of facts.entries()) {
      expect(
        dependencyEvidenceReceiptSchema.safeParse({
          ...receipt,
          receiptId: `receipt.gate-${index}`,
          fact,
        }).success,
      ).toBe(true);
      expect(
        dependencyEvidenceReceiptSchema.safeParse({
          ...receipt,
          receiptId: `receipt.gate-${index}`,
          fact: { ...fact, status: "SATISFIED" },
        }).success,
      ).toBe(false);
    }
  });
});
