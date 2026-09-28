import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { increaseSkuA50Cad, reduceSkuA10Percent, setSkuA849Cad } from "../../src/pricing/fixtures.js";
import { assessPortfolioCompatibility, priceBaselineBinding } from "../../src/action_conflicts/index.js";

function percent(id: string, factor: number) {
  const parameters = reduceSkuA10Percent.parameters;
  if (parameters.kind !== "price_adjustment") throw new Error("fixture must be pricing");
  return adaptLegacyAction(assertValidAction({ ...reduceSkuA10Percent, actionId: id, parameters: { ...parameters, operation: { ...parameters.operation, factor } } }));
}
const left = percent("action_price_sku_a_increase_10pct", 1.1);
const right = percent("action_price_sku_a_reduce_15pct", 0.85);
const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
const rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
const base = { evaluatedAt: "2026-09-20T13:00:00Z", evaluationBoundary: "DECISION_TIME" as const, horizonEnd: "2026-09-21T13:00:00Z", registry: [{ entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], timingContexts: {}, scopeIntersectionReceipts: [], partitionReceipts: [] };

describe("registered conflict adapters", () => {
  it("requires one exact fresh baseline for +10% versus -15% and then reports the contradiction", () => {
    const missing = assessPortfolioCompatibility([leftRef, rightRef], { ...base, priceBaselineReceipts: [] });
    expect(missing.status).toBe("UNKNOWN");
    const pairKey = [
      `ACTION:${left.actionId}:${leftRef.actionFingerprint}`,
      `ACTION:${right.actionId}:${rightRef.actionFingerprint}`,
    ].sort().join("|");
    const reference = (left.what as any).parameters.operation.reference;
    const { baselineRef, baselineFingerprint } = priceBaselineBinding(reference)!;
    const receipt = { receiptId: "receipt.price.baseline", baselineRef, baselineFingerprint, amountMinor: 10000, currency: "CAD", pairKey, evaluationBoundary: "DECISION_TIME" as const, observedAt: "2026-09-20T12:59:00Z", sourceRef: "catalog.price", provenance: ["catalog.snapshot"] };
    const conflict = assessPortfolioCompatibility([leftRef, rightRef], { ...base, maximumAgeSeconds: 300, priceBaselineReceipts: [receipt] });
    expect(conflict.status).toBe("CONFLICTING");
    expect(conflict.pairs[0]?.reasonCodes).toContain("CONTRADICTORY_VALUE_CHANGE");
    const duplicate = assessPortfolioCompatibility([leftRef, rightRef], { ...base, maximumAgeSeconds: 300, priceBaselineReceipts: [receipt, { ...receipt, receiptId: "receipt.price.duplicate" }] });
    expect(duplicate.status).toBe("UNKNOWN");
    expect(assessPortfolioCompatibility([leftRef, rightRef], { ...base, maximumAgeSeconds: 30, priceBaselineReceipts: [receipt] }).status).toBe("UNKNOWN");
    expect(assessPortfolioCompatibility([leftRef, rightRef], { ...base, maximumAgeSeconds: 300, priceBaselineReceipts: [{ ...receipt, pairKey: pairKey.replace("|", "|ACTION:action_wrong:fnv1a64:aaaaaaaaaaaaaaaa|") }] }).status).toBe("UNKNOWN");
  });

  it("requires evidence even for an explicit DELTA baseline", () => {
    const delta = adaptLegacyAction(increaseSkuA50Cad), set = adaptLegacyAction(setSkuA849Cad);
    const deltaRef = { entityKind: "ACTION" as const, actionId: delta.actionId, actionFingerprint: fingerprintCanonicalAction(delta) };
    const setRef = { entityKind: "ACTION" as const, actionId: set.actionId, actionFingerprint: fingerprintCanonicalAction(set) };
    const context = { ...base, registry: [{ entityKind: "ACTION" as const, action: delta }, { entityKind: "ACTION" as const, action: set }], priceBaselineReceipts: [] };
    expect(assessPortfolioCompatibility([deltaRef, setRef], context).status).toBe("UNKNOWN");
    const operation = (delta.what as any).parameters.operation;
    const binding = priceBaselineBinding(operation.reference)!;
    const pairKey = [`ACTION:${delta.actionId}:${deltaRef.actionFingerprint}`, `ACTION:${set.actionId}:${setRef.actionFingerprint}`].sort().join("|");
    const receipt = { receiptId: "receipt.explicit.baseline", ...binding, amountMinor: 89900, currency: "CAD", pairKey, evaluationBoundary: "DECISION_TIME" as const, observedAt: "2026-09-20T12:59:00Z", sourceRef: "catalog.price", provenance: ["catalog.snapshot"] };
    expect(assessPortfolioCompatibility([deltaRef, setRef], { ...context, priceBaselineReceipts: [receipt] }).status).toBe("CONFLICTING");
  });

  it("does not leak evidence from an equal-price candidate into a later explicit conflict", () => {
    const right = percent("action_equal_price_right", 0.9), rightRef = { entityKind: "ACTION" as const, actionId: right.actionId, actionFingerprint: fingerprintCanonicalAction(right) };
    const leftBase = percent("action_equal_price_left", 0.9);
    const left = { ...leftBase, conflicts: [{ conflictId: "explicit.global", kind: "MUTUALLY_EXCLUSIVE_INTENT" as const, target: { kind: "GLOBAL" as const }, scope: { coordinates: [{ kind: "GLOBAL" as const }] }, overlapRule: "EFFECTIVE_OVERLAP" as const, counterparty: rightRef }] };
    const leftRef = { entityKind: "ACTION" as const, actionId: left.actionId, actionFingerprint: fingerprintCanonicalAction(left) };
    const reference = (left.what as any).parameters.operation.reference, binding = priceBaselineBinding(reference)!;
    const key = [`ACTION:${left.actionId}:${leftRef.actionFingerprint}`, `ACTION:${right.actionId}:${rightRef.actionFingerprint}`].sort().join("|");
    const receipt = { receiptId: "receipt.equal.baseline", ...binding, amountMinor: 10000, currency: "CAD", pairKey: key, evaluationBoundary: "DECISION_TIME" as const, observedAt: "2026-09-20T12:59:00Z", sourceRef: "catalog.price", provenance: ["catalog.snapshot"] };
    const result = assessPortfolioCompatibility([leftRef, rightRef], { ...base, registry: [{ entityKind: "ACTION" as const, action: left }, { entityKind: "ACTION" as const, action: right }], priceBaselineReceipts: [receipt] });
    expect(result.status).toBe("CONFLICTING");
    expect(result.evidenceRefs).toEqual([]);
  });
});
