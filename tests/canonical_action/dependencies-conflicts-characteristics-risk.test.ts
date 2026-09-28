import { describe, expect, it } from "vitest";
import {
  assertNewCanonicalAction,
  canonicalActionSchema,
  createCanonicalFixtures,
  fingerprintCanonicalAction,
} from "../../src/canonical_action/index.js";

const fingerprint = "fnv1a64:0123456789abcdef";
const base = () => createCanonicalFixtures()[0]!.action!;
const dependency = (dependencyId = "dependency.inventory") => ({
  dependencyId,
  kind: "HARD_CONSTRAINT_GATE" as const,
  evaluationBoundary: "DECISION_TIME" as const,
  whenUnknown: "BLOCKED" as const,
  constraintId: "constraint.inventory",
  requiredStatus: "SATISFIED" as const,
});
const constraint = {
  constraintId: "constraint.inventory",
  kind: "INVENTORY_AVAILABILITY" as const,
  target: { kind: "PRODUCT" as const, ref: "product.alpha" },
  evaluationBoundary: "DECISION_TIME" as const,
  whenUnknown: "INELIGIBLE" as const,
  resourceRequirementId: "resource.units-needed",
  availableValue: { kind: "FACT" as const, ref: "inventory.available" },
};
const conflict = (conflictId = "conflict.price") => ({
  conflictId,
  kind: "CONTRADICTORY_VALUE_CHANGE" as const,
  target: { kind: "PRODUCT" as const, ref: "product.alpha" },
  scope: { coordinates: [{ kind: "PRODUCT" as const, productRef: "product.alpha" }] },
  overlapRule: "EFFECTIVE_OVERLAP" as const,
  counterparty: { registryRef: "conflicts.pricing", code: "opposite_change", version: "1" },
});
const characteristics = {
  implementationCost: [{
    lineItemId: "cost.media",
    category: "MEDIA" as const,
    amount: { state: "KNOWN" as const, value: { amountMinor: 100, currency: "USD" } },
  }],
  reversibility: {
    kind: "FULLY_REVERSIBLE" as const,
    reversal: { kind: "ACTION" as const, actionId: "action_reverse", actionFingerprint: fingerprint },
  },
  cancellationCosts: [{ stage: "BEFORE_START" as const, cancellationAvailable: true, cancellationCost: [], compensationCost: [], operationalBurden: [] }],
  operationalBurden: [],
};
const commonRisk = {
  horizon: { amount: 7, unit: "DAY" as const },
  aggregation: "INTERVAL" as const,
  evidencePolicyRef: "policy.observed",
  sourceDefinitionRef: { registryRef: "risk.sources", code: "ledger", version: "1" },
};
const population = {
  populationId: "population_customers", version: 1,
  definitionFingerprint: fingerprint,
  binding: "DECISION_TIME" as const,
  membershipMode: "FROZEN_MEMBERSHIP" as const,
  snapshotRef: "snapshot_customers",
};
const riskDimensions = {
  FINANCIAL_DOWNSIDE: [{ ...commonRisk, measurementId: "risk.financial", metricRef: "metric.loss", dimension: "FINANCIAL_DOWNSIDE" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "MONEY" as const, currency: "USD" }, lossBaselineRef: "baseline.financial" }],
  IRREVERSIBILITY: [{ ...commonRisk, measurementId: "risk.irreversible", metricRef: "metric.irreversible", dimension: "IRREVERSIBILITY" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "PERCENTAGE" as const }, reversibilityContractRef: "characteristics.reversibility", irreversibleEffectKinds: ["CUSTOMER_EXPOSED" as const], restorationCriterionRef: "criterion.restored" }],
  UNCERTAINTY: [{ ...commonRisk, measurementId: "risk.uncertainty", metricRef: "metric.uncertainty", dimension: "UNCERTAINTY" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "PERCENTAGE" as const }, uncertainQuantityRef: "quantity.response", uncertaintySource: { kind: "PARAMETER_METRIC" as const, parameterRef: "parameter.response", metricRef: "metric.response" } }],
  INVENTORY_EXPOSURE: [{ ...commonRisk, measurementId: "risk.inventory", metricRef: "metric.inventory", dimension: "INVENTORY_EXPOSURE" as const, inventoryTarget: { productRef: "product.alpha" }, valueType: { kind: "QUANTITY" as const, unit: "units" as const } }],
  CUSTOMER_IMPACT: [{ ...commonRisk, measurementId: "risk.customer", metricRef: "metric.customer", dimension: "CUSTOMER_IMPACT" as const, population, impactFamily: { registryRef: "risk.customer", code: "disruption", version: "1" }, valueType: { kind: "QUANTITY" as const, unit: "customers" as const } }],
  TIME_TO_RECOVERY: [{ ...commonRisk, measurementId: "risk.recovery", metricRef: "metric.recovery", dimension: "TIME_TO_RECOVERY" as const, target: { kind: "GLOBAL" as const }, recoveryBaselineRef: "baseline.recovery", recoveryCriterionRef: "criterion.recovery", startBoundary: "ACTION_EFFECTIVE" as const, valueType: { kind: "DURATION" as const, unit: "HOUR" as const } }],
};

describe("canonical portfolio definition integration", () => {
  it("defaults historical v2 payloads without changing locked fingerprints", () => {
    const expected = ["fnv1a64:d9de269484c968e1", "fnv1a64:2ed6149a06acf666", "fnv1a64:521ff8724835d6e3"];
    const parsed = [0, 2, 25].map((index) => canonicalActionSchema.parse(createCanonicalFixtures()[index]!.action!));
    expect(parsed.map(fingerprintCanonicalAction)).toEqual(expected);
    for (const action of parsed) {
      expect(action.dependencies).toEqual([]);
      expect(action.conflicts).toEqual([]);
      expect(action.characteristics).toEqual({ state: "ABSENT" });
      expect(action.riskDimensions).toEqual({ state: "ABSENT" });
    }
  });

  it("includes definitions in identity and canonicalizes set-like arrays", () => {
    const action = base();
    const entityDependency = {
      dependencyId: "dependency.entity",
      kind: "ENTITY_LIFECYCLE" as const,
      evaluationBoundary: "DECISION_TIME" as const,
      whenUnknown: "UNKNOWN" as const,
      prerequisite: { entityKind: "ACTION" as const, actionId: "action_prerequisite", actionFingerprint: fingerprint },
      requiredState: "COMPLETED" as const,
    };
    const originalFingerprint = fingerprintCanonicalAction(action);
    for (const addition of [
      { dependencies: [entityDependency] },
      { conflicts: [conflict()] },
      { characteristics: { state: "PRESENT" as const, value: characteristics } },
      { riskDimensions },
    ]) expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...action, ...addition }))).not.toBe(originalFingerprint);
    const extended = canonicalActionSchema.parse({
      ...action,
      constraints: [constraint],
      dependencies: [dependency("dependency.z"), dependency("dependency.a"), entityDependency],
      conflicts: [conflict("conflict.z"), conflict("conflict.a")],
      characteristics: { state: "PRESENT", value: characteristics },
      riskDimensions,
    });
    expect(fingerprintCanonicalAction(extended)).not.toBe(fingerprintCanonicalAction(action));
    expect(fingerprintCanonicalAction(extended)).toBe(fingerprintCanonicalAction(canonicalActionSchema.parse({
      ...extended,
      dependencies: [...extended.dependencies].reverse(),
      conflicts: [...extended.conflicts].reverse(),
      riskDimensions: Object.fromEntries(Object.entries(riskDimensions).map(([key, values]) => [key, [...values].reverse()])),
    })));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, constraints: [{ ...constraint, evaluationBoundary: "TRANSLATION_TIME" }], dependencies: extended.dependencies.map((item) => item.kind === "HARD_CONSTRAINT_GATE" ? { ...item, evaluationBoundary: "TRANSLATION_TIME" as const } : item) }))).not.toBe(fingerprintCanonicalAction(extended));
    const parsedEntityDependency = extended.dependencies.find((item) => item.kind === "ENTITY_LIFECYCLE")!;
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, dependencies: extended.dependencies.map((item) => item === parsedEntityDependency ? { ...parsedEntityDependency, prerequisite: { ...parsedEntityDependency.prerequisite, actionFingerprint: "fnv1a64:fedcba9876543210" } } : item) }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, conflicts: extended.conflicts.map((item, index) => index === 0 ? { ...item, scope: { coordinates: [{ kind: "CHANNEL" as const, channelRef: "channel.email" }] } } : item) }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, characteristics: { state: "PRESENT", value: { ...characteristics, implementationCost: [{ ...characteristics.implementationCost[0], category: "LABOR" }] } } }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, characteristics: { state: "PRESENT", value: { ...characteristics, implementationCost: [{ ...characteristics.implementationCost[0], amount: { state: "RANGE", minimum: { amountMinor: 50, currency: "CAD" }, maximum: { amountMinor: 150, currency: "CAD" } } }] } } }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, characteristics: { state: "PRESENT", value: { ...characteristics, cancellationCosts: [{ ...characteristics.cancellationCosts[0], stage: "IMPLEMENTING" }] } } }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, characteristics: { state: "PRESENT", value: { ...characteristics, reversibility: { ...characteristics.reversibility, reversal: { ...characteristics.reversibility.reversal, actionFingerprint: "fnv1a64:fedcba9876543210" } } } } }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, riskDimensions: { ...riskDimensions, FINANCIAL_DOWNSIDE: [{ ...riskDimensions.FINANCIAL_DOWNSIDE[0], measurementId: "risk.financial.changed" }] } }))).not.toBe(fingerprintCanonicalAction(extended));
    expect(fingerprintCanonicalAction(canonicalActionSchema.parse({ ...extended, riskDimensions: { ...riskDimensions, FINANCIAL_DOWNSIDE: [{ ...riskDimensions.FINANCIAL_DOWNSIDE[0], target: { kind: "PRODUCT", ref: "product.beta" }, horizon: { amount: 8, unit: "DAY" }, valueType: { kind: "MONEY", currency: "CAD" } }] } }))).not.toBe(fingerprintCanonicalAction(extended));
  });

  it("validates local gates without resolving registries or graphs", () => {
    const action = base();
    expect(canonicalActionSchema.safeParse({ ...action, constraints: [constraint], dependencies: [dependency()] }).success).toBe(true);
    expect(canonicalActionSchema.safeParse({ ...action, dependencies: [dependency()] }).success).toBe(false);
    expect(canonicalActionSchema.safeParse({ ...action, constraints: [constraint], dependencies: [{ ...dependency(), evaluationBoundary: "TRANSLATION_TIME" }] }).success).toBe(false);
    expect(canonicalActionSchema.safeParse({ ...action, dependencies: [{ ...dependency(), kind: "ELIGIBILITY_CHECK_GATE", checkId: "missing.check" }] }).success).toBe(false);
    expect(canonicalActionSchema.safeParse({ ...action, dependencies: [{ dependencyId: "dependency.audience", kind: "ELIGIBILITY_CHECK_GATE", evaluationBoundary: "EFFECTIVE_TIME", whenUnknown: "BLOCKED", checkId: "domain.lifecycle.audience_available", requiredStatus: "SATISFIED" }] }).success).toBe(true);
  });

  it("requires complete explicit definition states from the new-author helper", () => {
    const action = base();
    expect(() => assertNewCanonicalAction({ ...action, characteristics: { state: "PRESENT", value: characteristics }, riskDimensions })).not.toThrow();
    expect(() => assertNewCanonicalAction(action)).toThrow();
    expect(() => assertNewCanonicalAction({ ...action, characteristics: { state: "ABSENT" }, riskDimensions })).toThrow();
  });
});
