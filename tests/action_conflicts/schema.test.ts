import { describe, expect, it } from "vitest";
import {
  actionConflictDefinitionSchema,
  actionConflictsSchema,
  canonicalConflictEntityKey,
  conflictScopeSchema,
  conflictRelationIdentityInputSchema,
  normalizeConflictRelationIdentity,
  normalizedConflictRelationIdentitySchema,
  scopeIntersectionEvidenceSchema,
  scopeIntersectionEvidenceReceiptsSchema,
} from "../../src/action_conflicts/index.js";

const fpA = "fnv1a64:aaaaaaaaaaaaaaaa";
const fpB = "fnv1a64:bbbbbbbbbbbbbbbb";
const scopeFpA = "fnv1a64:1111111111111111";
const scopeFpB = "fnv1a64:2222222222222222";

const exactAction = {
  entityKind: "ACTION" as const,
  actionId: "action_price_up",
  actionFingerprint: fpA,
};

const definition = {
  conflictId: "conflict.price.change",
  kind: "CONTRADICTORY_VALUE_CHANGE" as const,
  target: { kind: "PRODUCT" as const, ref: "product_a" },
  scope: {
    coordinates: [{ kind: "PRODUCT" as const, productRef: "product_a" }],
  },
  overlapRule: "EFFECTIVE_OVERLAP" as const,
  counterparty: exactAction,
};

describe("pure action conflict contracts", () => {
  it("accepts every closed coordinate kind", () => {
    const coordinates = [
      { kind: "GLOBAL" },
      { kind: "PRODUCT", productRef: "product_a" },
      { kind: "VARIANT", productRef: "product_a", variantRef: "variant_a" },
      { kind: "CHANNEL", channelRef: "channel_email" },
      {
        kind: "PLACEMENT",
        channelRef: "channel_paid_social",
        placementRef: "placement_feed",
      },
      {
        kind: "POPULATION",
        populationId: "population_winback",
        version: 1,
        definitionFingerprint: fpA,
        binding: "SEND_TIME",
        membershipMode: "FROZEN_MEMBERSHIP",
        snapshotRef: "snapshot_winback",
      },
      { kind: "RESOURCE", resourceRef: "resource_budget", unit: "USD_MINOR" },
      {
        kind: "CUSTOM",
        registryRef: "registry.market",
        code: "region.ca",
        version: "2026-09",
      },
    ];

    for (const coordinate of coordinates) {
      expect(
        conflictScopeSchema.safeParse({ coordinates: [coordinate] }).success,
      ).toBe(true);
    }
  });

  it("requires a non-empty, dimension-unique closed scope", () => {
    expect(conflictScopeSchema.safeParse({ coordinates: [] }).success).toBe(false);
    expect(
      conflictScopeSchema.safeParse({
        coordinates: [
          { kind: "PRODUCT", productRef: "product_a" },
          { kind: "VARIANT", productRef: "product_a", variantRef: "variant_a" },
        ],
      }).success,
    ).toBe(false);
    expect(
      conflictScopeSchema.safeParse({
        coordinates: [
          { kind: "GLOBAL" },
          { kind: "CHANNEL", channelRef: "channel_email" },
        ],
      }).success,
    ).toBe(false);
    expect(
      conflictScopeSchema.safeParse({
        coordinates: [{ kind: "PRODUCT", productRef: "product_a", label: "A" }],
      }).success,
    ).toBe(false);
  });

  it("accepts all conflict kinds, both temporal modes, and exact or registered counterparties", () => {
    const kinds = [
      "MUTUALLY_EXCLUSIVE_INTENT",
      "CONTRADICTORY_VALUE_CHANGE",
      "EXCLUSIVE_RESOURCE",
      "POLICY_PROHIBITION",
      "CUSTOM",
    ] as const;
    for (const kind of kinds)
      expect(actionConflictDefinitionSchema.parse({ ...definition, kind })).toBeTruthy();

    expect(
      actionConflictDefinitionSchema.parse({
        ...definition,
        overlapRule: "ANY_OVERLAP",
        counterparty: {
          registryRef: "registry.conflicts",
          code: "pricing.opposition",
          version: "2",
        },
      }),
    ).toBeTruthy();
    expect(
      actionConflictDefinitionSchema.safeParse({ ...definition, overlapRule: "PERSISTENT" })
        .success,
    ).toBe(false);
    expect(
      actionConflictDefinitionSchema.safeParse({
        ...definition,
        counterparty: {
          entityKind: "COMPOUND",
          compoundActionId: "compound_price_change",
          compoundFingerprint: fpB,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate conflict IDs and optimizer leakage", () => {
    expect(actionConflictsSchema.safeParse([definition, definition]).success).toBe(false);
    for (const leaked of [
      "winner",
      "priority",
      "utility",
      "rank",
      "score",
      "recommendation",
      "selectedAction",
      "repair",
    ]) {
      expect(
        actionConflictDefinitionSchema.safeParse({ ...definition, [leaked]: "forbidden" })
          .success,
      ).toBe(false);
    }
  });

  it("normalizes exact endpoint direction and corresponding scope fingerprints", () => {
    const left = { entityKind: "ACTION" as const, actionId: "action_z", actionFingerprint: fpB };
    const right = { entityKind: "ACTION" as const, actionId: "action_a", actionFingerprint: fpA };
    const forward = normalizeConflictRelationIdentity({
      left,
      right,
      kind: "CONTRADICTORY_VALUE_CHANGE",
      targetFingerprint: fpA,
      leftScopeFingerprint: scopeFpA,
      rightScopeFingerprint: scopeFpB,
      temporalMode: "EFFECTIVE_OVERLAP",
    });
    const reverse = normalizeConflictRelationIdentity({
      left: right,
      right: left,
      kind: "CONTRADICTORY_VALUE_CHANGE",
      targetFingerprint: fpA,
      leftScopeFingerprint: scopeFpB,
      rightScopeFingerprint: scopeFpA,
      temporalMode: "EFFECTIVE_OVERLAP",
    });
    expect(forward).toEqual(reverse);
    expect(forward.leftEntityKey).toContain("action_a");
    expect(forward.leftScopeFingerprint).toBe(scopeFpB);
    expect(normalizedConflictRelationIdentitySchema.parse(forward)).toEqual(forward);
    expect(
      conflictRelationIdentityInputSchema.safeParse({
        left,
        right,
        kind: "CONTRADICTORY_VALUE_CHANGE",
        targetFingerprint: "not-a-fingerprint",
        leftScopeFingerprint: scopeFpA,
        rightScopeFingerprint: scopeFpB,
        temporalMode: "EFFECTIVE_OVERLAP",
      }).success,
    ).toBe(false);

    const selfForward = normalizeConflictRelationIdentity({
      left: right,
      right,
      kind: "CUSTOM",
      targetFingerprint: fpA,
      leftScopeFingerprint: scopeFpB,
      rightScopeFingerprint: scopeFpA,
      temporalMode: "ANY_OVERLAP",
    });
    const selfReverse = normalizeConflictRelationIdentity({
      left: right,
      right,
      kind: "CUSTOM",
      targetFingerprint: fpA,
      leftScopeFingerprint: scopeFpA,
      rightScopeFingerprint: scopeFpB,
      temporalMode: "ANY_OVERLAP",
    });
    expect(selfForward).toEqual(selfReverse);
  });

  it("requires complete versioned registry identity in normalized relations", () => {
    expect(
      normalizedConflictRelationIdentitySchema.safeParse({
        leftEntityKey: `ACTION:action_a:${fpA}`,
        rightEntityKey: `ACTION:action_b:${fpB}`,
        kind: "CUSTOM",
        targetFingerprint: fpA,
        leftScopeFingerprint: scopeFpA,
        rightScopeFingerprint: scopeFpB,
        temporalMode: "ANY_OVERLAP",
        registryIdentity: {
          registryRef: "registry.custom",
          code: "custom.relation",
        },
      }).success,
    ).toBe(false);
    expect(
      normalizedConflictRelationIdentitySchema.safeParse({
        leftEntityKey: `ACTION:action_a:${fpA}`,
        rightEntityKey: `ACTION:action_a:${fpA}`,
        kind: "CUSTOM",
        targetFingerprint: fpA,
        leftScopeFingerprint: scopeFpB,
        rightScopeFingerprint: scopeFpA,
        temporalMode: "ANY_OVERLAP",
      }).success,
    ).toBe(false);
  });

  it("binds scope intersection evidence exactly without accepting status wrappers", () => {
    const receipt = {
      receiptId: "receipt.scope.1",
      pairKey: `ACTION:action_a:${fpA}|ACTION:action_b:${fpB}`,
      leftScopeFingerprint: scopeFpA,
      rightScopeFingerprint: scopeFpB,
      evaluationBoundary: "TRANSLATION_TIME",
      observedAt: "2026-09-28T12:00:00.000Z",
      sourceRef: "source.segment.engine",
      provenance: ["evidence.segment.1"],
      intersection: "DISJOINT",
    } as const;
    expect(scopeIntersectionEvidenceSchema.parse(receipt)).toEqual(receipt);
    expect(
      scopeIntersectionEvidenceSchema.safeParse({ ...receipt, status: "COMPATIBLE" })
        .success,
    ).toBe(false);
    expect(
      scopeIntersectionEvidenceSchema.safeParse({
        ...receipt,
        observedAt: "2026-09-28T08:00:00-04:00",
      }).success,
    ).toBe(false);
    expect(
      scopeIntersectionEvidenceReceiptsSchema.safeParse([receipt, receipt]).success,
    ).toBe(false);
    expect(
      scopeIntersectionEvidenceSchema.safeParse({
        ...receipt,
        pairKey: `ACTION:action_b:${fpB}|ACTION:action_a:${fpA}`,
      }).success,
    ).toBe(false);
  });

  it("validates canonical entity references before constructing public keys", () => {
    expect(() =>
      canonicalConflictEntityKey({
        entityKind: "ACTION",
        actionId: "invalid",
        actionFingerprint: fpA,
      } as never),
    ).toThrow();
  });

  it("leaves registry resolution and intersection claims to assessment", () => {
    expect(
      actionConflictDefinitionSchema.safeParse({
        ...definition,
        counterparty: {
          registryRef: "registry.missing.at.definition.time",
          code: "unknown.until.assessment",
          version: "1",
        },
      }).success,
    ).toBe(true);
  });
});
