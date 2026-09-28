import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { reduceSkuA10Percent } from "../../src/pricing/fixtures.js";
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
  });
});
