import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import {
  canonicalEligibilityTargetRef,
  evaluateActionEligibility,
  type DomainEligibilityFact,
} from "../../src/action_eligibility/index.js";
import { reorderSkuA100, reorderSkuB50SupplierX } from "../../src/inventory/fixtures.js";
import { googleBudgetUp2000, metaBudgetDown2000 } from "../../src/action_translation/fixtures.js";
import { actionTypeIsolationScenarios, domainAdapterScenarios, hardConstraintEligibilityScenarios, inventoryAvailabilityScenarios } from "../../src/action_eligibility/fixtures.js";

const NOW = "2026-09-27T12:00:00.000Z";

function fact(
  action: ReturnType<typeof adaptLegacyAction>,
  factId: DomainEligibilityFact["factId"],
  value: boolean,
  overrides: Partial<DomainEligibilityFact> = {},
): DomainEligibilityFact {
  return {
    kind: "DOMAIN_FACT",
    factId,
    value,
    evidenceRef: `evidence:${factId}`,
    actionId: action.actionId,
    actionFingerprint: fingerprintCanonicalAction(action),
    targetRef: canonicalEligibilityTargetRef(action),
    evaluationBoundary: "DECISION_TIME",
    observedAt: NOW,
    sourceRef: "merchant-state:v1",
    provenance: ["merchant-snapshot:2026-09-27"],
    ...overrides,
  };
}

function evaluate(action: ReturnType<typeof adaptLegacyAction>, domainFacts: unknown[]) {
  const result = evaluateActionEligibility(
    { action },
    { evaluatedAt: NOW, maximumAgeSeconds: 3600, observations: [], domainFacts },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.failure.messages.join("; "));
  return result.result;
}

describe("evidence-derived domain eligibility", () => {
  it("blocks an inventory increase for a discontinued product", () => {
    const action = adaptLegacyAction(reorderSkuA100);
    const result = evaluate(action, [
      fact(action, "TARGET_ACTIVE", false),
      fact(action, "ACTION_FAMILY_CAPABILITY", true),
      fact(action, "SUPPLIER_AVAILABLE", true),
      fact(action, "WAREHOUSE_AVAILABLE", true),
    ]);
    expect(result.status).toBe("INELIGIBLE");
    expect(result.checks.find((check) => check.checkId === "domain.inventory.target_active")).toMatchObject({
      status: "VIOLATED",
      reasonCodes: ["TARGET_INACTIVE"],
    });
  });

  it("permits an inventory increase when all applicability facts are current and true", () => {
    const action = adaptLegacyAction(reorderSkuA100);
    const result = evaluate(action, [
      fact(action, "TARGET_ACTIVE", true),
      fact(action, "ACTION_FAMILY_CAPABILITY", true),
      fact(action, "SUPPLIER_AVAILABLE", true),
      fact(action, "WAREHOUSE_AVAILABLE", true),
    ]);
    expect(result.status).toBe("ELIGIBLE");
    expect(result.checks.map((check) => check.checkId)).toEqual([
      "domain.inventory.capability",
      "domain.inventory.supplier_available",
      "domain.inventory.target_active",
      "domain.inventory.warehouse_available",
    ]);
  });

  it("does not fail open when an applicable adapter has no domain facts", () => {
    const result = evaluate(adaptLegacyAction(reorderSkuA100), []);
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.every((check) => check.status === "UNKNOWN")).toBe(true);
  });

  it("treats an omitted domain-fact collection as missing evidence", () => {
    const action = adaptLegacyAction(reorderSkuA100);
    const result = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [] });
    expect(result.ok && result.result.status).toBe("UNKNOWN");
  });

  it("does not accept a SKU A fact for SKU B", () => {
    const skuA = adaptLegacyAction(reorderSkuA100);
    const skuB = adaptLegacyAction(reorderSkuB50SupplierX);
    const result = evaluate(skuB, [fact(skuA, "TARGET_ACTIVE", true)]);
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.find((check) => check.checkId === "domain.inventory.target_active")?.reasonCodes).toEqual(["MISSING_BOUND_DOMAIN_FACT"]);
  });

  it("blocks paid media on a channel the merchant does not use", () => {
    const action = adaptLegacyAction(metaBudgetDown2000);
    const result = evaluate(action, [
      fact(action, "ACTION_FAMILY_CAPABILITY", true),
      fact(action, "CHANNEL_MERCHANT_ENABLED", false),
    ]);
    expect(result.status).toBe("INELIGIBLE");
    expect(result.checks.find((check) => check.checkId === "domain.paid_media.channel_enabled")).toMatchObject({
      status: "VIOLATED",
      reasonCodes: ["CHANNEL_NOT_MERCHANT_ENABLED"],
    });
  });

  it("does not accept Meta channel evidence for Google", () => {
    const meta = adaptLegacyAction(metaBudgetDown2000);
    const google = adaptLegacyAction(googleBudgetUp2000);
    const result = evaluate(google, [fact(meta, "CHANNEL_MERCHANT_ENABLED", true)]);
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.find((check) => check.checkId === "domain.paid_media.channel_enabled")?.evidenceRefs).toEqual([]);
  });

  it.each([
    ["stale", "2026-09-27T10:00:00.000Z", "STALE_DOMAIN_FACT"],
    ["future", "2026-09-27T13:00:00.000Z", "FUTURE_DOMAIN_FACT"],
  ])("treats %s domain facts as unknown", (_label, observedAt, reason) => {
    const action = adaptLegacyAction(metaBudgetDown2000);
    const result = evaluate(action, [fact(action, "CHANNEL_MERCHANT_ENABLED", true, { observedAt })]);
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.find((check) => check.checkId === "domain.paid_media.channel_enabled")?.reasonCodes).toEqual([reason]);
  });

  it("rejects duplicate domain facts rather than choosing by input order", () => {
    const action = adaptLegacyAction(metaBudgetDown2000);
    const duplicate = fact(action, "CHANNEL_MERCHANT_ENABLED", true);
    const result = evaluateActionEligibility(
      { action },
      { evaluatedAt: NOW, observations: [], domainFacts: [duplicate, { ...duplicate, evidenceRef: "evidence:second" }] },
    );
    expect(result).toMatchObject({ ok: false, failure: { code: "INVALID_CONTEXT" } });
  });

  it.each(domainAdapterScenarios)("evaluates $family applicability from bound facts", ({ action, facts, representativeFactId }) => {
    const eligible = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [], domainFacts: facts });
    expect(eligible.ok && eligible.result.status).toBe("ELIGIBLE");

    const missing = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [], domainFacts: facts.filter((entry) => entry.factId !== representativeFactId) });
    expect(missing.ok && missing.result.status).toBe("UNKNOWN");

    const deniedFacts = facts.map((entry) => entry.factId === representativeFactId ? { ...entry, value: false } : entry);
    const denied = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [], domainFacts: deniedFacts });
    expect(denied.ok && denied.result.status).toBe("INELIGIBLE");
    expect(denied.ok && denied.result.checks.some((check) => check.kind === "DOMAIN_RULE" && check.status === "VIOLATED")).toBe(true);
  });

  it.each(actionTypeIsolationScenarios)("does not impose unrelated $excludedFactId evidence", ({ action, facts, excludedFactId }) => {
    const result = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [], domainFacts: facts });
    expect(result.ok && result.result.status).toBe("ELIGIBLE");
    expect(result.ok && result.result.checks.some((check) => check.checkId.endsWith(excludedFactId.toLowerCase()))).toBe(false);
  });

  it.each(hardConstraintEligibilityScenarios)("evaluates $kind through unified eligibility", ({ action, nativeConstraints, domainFacts, receipts }) => {
    const result = evaluateActionEligibility({ action, nativeConstraints }, { evaluatedAt: NOW, observations: [], domainFacts, constraintReceipts: receipts });
    expect(result.ok && result.result.status).toBe("INELIGIBLE");
    expect(result.ok && result.result.checks.some((check) => check.kind === "HARD_CONSTRAINT" && check.status === "VIOLATED")).toBe(true);
  });

  it.each(inventoryAvailabilityScenarios)("blocks inventory reorder when $factId is false", ({ action, facts, factId, checkId, reasonCode }) => {
    const result = evaluateActionEligibility({ action }, { evaluatedAt: NOW, observations: [], domainFacts: facts });
    expect(result.ok && result.result.status).toBe("INELIGIBLE");
    expect(result.ok && result.result.checks.find((check) => check.checkId === checkId)).toMatchObject({
      kind: "DOMAIN_RULE",
      status: "VIOLATED",
      reasonCodes: [reasonCode],
    });
  });

  it("keeps inventory eligibility unknown when supplier evidence is missing", () => {
    const scenario = inventoryAvailabilityScenarios[0]!;
    const result = evaluateActionEligibility(
      { action: scenario.action },
      { evaluatedAt: NOW, observations: [], domainFacts: scenario.facts.filter((fact) => fact.factId !== "SUPPLIER_AVAILABLE") },
    );
    expect(result.ok && result.result.status).toBe("UNKNOWN");
    expect(result.ok && result.result.checks.find((check) => check.checkId === "domain.inventory.supplier_available")).toMatchObject({
      status: "UNKNOWN",
      reasonCodes: ["MISSING_BOUND_DOMAIN_FACT"],
    });
  });

  it("accepts a price exactly at its floor, leaves missing evidence unknown, and rejects another target's receipt", () => {
    const scenario = hardConstraintEligibilityScenarios.find((entry) => entry.kind === "PRICE_FLOOR")!;
    const receipt = scenario.receipts[0]!;
    if (receipt.fact.kind !== "VALUE" || receipt.fact.value.valueType !== "MONEY") throw new Error("price fixture must carry money evidence");
    const boundaryReceipt = { ...receipt, fact: { ...receipt.fact, value: { ...receipt.fact.value, amountMinor: 8_000 } } };
    const boundary = evaluateActionEligibility({ action: scenario.action, nativeConstraints: scenario.nativeConstraints }, { evaluatedAt: NOW, observations: [], domainFacts: scenario.domainFacts, constraintReceipts: [boundaryReceipt] });
    expect(boundary.ok && boundary.result.status).toBe("ELIGIBLE");
    const missing = evaluateActionEligibility({ action: scenario.action, nativeConstraints: scenario.nativeConstraints }, { evaluatedAt: NOW, observations: [], domainFacts: scenario.domainFacts, constraintReceipts: [] });
    expect(missing.ok && missing.result.status).toBe("UNKNOWN");
    const wrongTarget = { ...receipt, target: { kind: "SKU" as const, ref: "sku:B" } };
    const mismatched = evaluateActionEligibility({ action: scenario.action, nativeConstraints: scenario.nativeConstraints }, { evaluatedAt: NOW, observations: [], domainFacts: scenario.domainFacts, constraintReceipts: [wrongTarget] });
    expect(mismatched.ok && mismatched.result.status).toBe("UNKNOWN");
  });
});
