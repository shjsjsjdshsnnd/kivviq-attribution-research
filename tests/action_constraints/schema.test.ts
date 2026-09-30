import { describe, expect, it } from "vitest";
import {
  hardConstraintSchema,
  hardConstraintsSchema,
} from "../../src/action_constraints/index.js";

const common = {
  constraintId: "constraint.price-floor",
  evaluationBoundary: "TRANSLATION_TIME" as const,
  whenUnknown: "INELIGIBLE" as const,
};
const sku = { kind: "SKU" as const, ref: "sku.boot.black.9" };
const metric = { kind: "METRIC" as const, ref: "metric.available" };

const validConstraints = [
  {
    ...common,
    constraintId: "constraint.budget",
    kind: "AVAILABLE_BUDGET",
    target: { kind: "CHANNEL", ref: "channel.meta" },
    resourceRequirementId: "resource.paid-media-budget",
    availableValue: metric,
  },
  {
    ...common,
    constraintId: "constraint.margin",
    kind: "MINIMUM_MARGIN",
    target: sku,
    valueBasis: "PROJECTED_AFTER_ACTION",
    comparator: "GTE",
    threshold: { valueType: "PERCENTAGE", basisPoints: 2500 },
    observedValue: { kind: "METRIC", ref: "metric.projected-margin" },
  },
  {
    ...common,
    constraintId: "constraint.floor",
    kind: "PRICE_FLOOR",
    target: sku,
    valueBasis: "PROJECTED_AFTER_ACTION",
    comparator: "GTE",
    threshold: { valueType: "MONEY", amountMinor: 7999, currency: "CAD" },
    observedValue: { kind: "FACT", ref: "fact.projected-price" },
  },
  {
    ...common,
    constraintId: "constraint.inventory",
    kind: "INVENTORY_AVAILABILITY",
    target: sku,
    resourceRequirementId: "resource.units-needed",
    availableValue: { kind: "FACT", ref: "fact.sellable-units" },
  },
  {
    ...common,
    constraintId: "constraint.policy",
    kind: "MERCHANT_POLICY",
    target: { kind: "FAMILY", family: "PRICING" },
    rule: {
      registryRef: "merchant-policy.main",
      ruleId: "rule.no-loss-leaders",
      version: "2026.09",
      effectiveFrom: "2026-09-01T00:00:00Z",
      effectiveUntil: "2026-12-01T00:00:00Z",
    },
    expectedDecision: "ALLOW",
  },
  {
    ...common,
    constraintId: "constraint.channel",
    kind: "CHANNEL_AVAILABILITY",
    target: { kind: "CHANNEL", ref: "channel.google" },
    availabilityFact: { kind: "FACT", ref: "fact.channel-enabled" },
    expectedStatus: "AVAILABLE",
  },
  {
    ...common,
    constraintId: "constraint.capacity",
    kind: "OPERATIONAL_CAPACITY",
    target: { kind: "RESOURCE", ref: "warehouse.picking" },
    resourceRequirementId: "resource.pick-hours",
    availableValue: { kind: "METRIC", ref: "metric.pick-hours-available" },
  },
  {
    ...common,
    constraintId: "constraint.discount",
    kind: "MAXIMUM_DISCOUNT",
    target: sku,
    valueBasis: "PROJECTED_AFTER_ACTION",
    comparator: "LTE",
    threshold: { valueType: "PERCENTAGE", basisPoints: 3000 },
    observedValue: { kind: "METRIC", ref: "metric.projected-discount" },
  },
  {
    ...common,
    constraintId: "constraint.contract",
    kind: "CONTRACTUAL_RESTRICTION",
    target: { kind: "CHANNEL", ref: "channel.marketplace" },
    rule: {
      registryRef: "contracts.marketplace",
      ruleId: "rule.minimum-advertised-price",
      version: "v4",
      effectiveFrom: "2026-01-01T00:00:00Z",
    },
    expectedDecision: "ALLOW",
  },
  {
    ...common,
    constraintId: "constraint.risk",
    kind: "RISK_LIMIT",
    target: { kind: "PRODUCT", ref: "product.boot" },
    valueBasis: "PROJECTED_AFTER_ACTION",
    metricRef: "metric.return-rate",
    comparator: "LTE",
    threshold: { valueType: "SCALAR", value: 0.12, unit: "ratio" },
    horizon: { amount: 30, unit: "DAY" },
  },
  {
    ...common,
    constraintId: "constraint.custom",
    kind: "CUSTOM",
    target: { kind: "GLOBAL" },
    registryRef: "constraint-registry.custom",
    code: "LEGAL_REVIEW_PRESENT",
  },
] as const;

describe("hardConstraintSchema", () => {
  it.each(validConstraints)("accepts $kind", (constraint) => {
    expect(hardConstraintSchema.parse(constraint)).toEqual(constraint);
  });

  it("requires safe stable identities and strict shapes", () => {
    expect(() =>
      hardConstraintSchema.parse({ ...validConstraints[10], constraintId: "bad id" }),
    ).toThrow();
    expect(() =>
      hardConstraintSchema.parse({ ...validConstraints[10], explanation: "trust me" }),
    ).toThrow();
    expect(() =>
      hardConstraintSchema.parse({ ...validConstraints[5], target: sku }),
    ).toThrow();
  });

  it("rejects invalid typed thresholds, units, currencies, and ranges", () => {
    const floor = validConstraints[2];
    expect(() => hardConstraintSchema.parse({ ...floor, threshold: { ...floor.threshold, amountMinor: 1.2 } })).toThrow();
    expect(() => hardConstraintSchema.parse({ ...floor, threshold: { ...floor.threshold, currency: "cad" } })).toThrow();
    const discount = validConstraints[7];
    expect(() => hardConstraintSchema.parse({ ...discount, threshold: { ...discount.threshold, basisPoints: 10_001 } })).toThrow();
    const risk = validConstraints[9];
    expect(() => hardConstraintSchema.parse({ ...risk, threshold: { ...risk.threshold, unit: "bad unit" } })).toThrow();
    expect(() => hardConstraintSchema.parse({ ...risk, horizon: { amount: 0, unit: "DAY" } })).toThrow();
  });

  it("requires an explicit current or projected value basis for value checks", () => {
    for (const constraint of [validConstraints[1], validConstraints[2], validConstraints[7], validConstraints[9]]) {
      expect(hardConstraintSchema.parse({ ...constraint, valueBasis: "CURRENT_STATE" })).toMatchObject({ valueBasis: "CURRENT_STATE" });
      const { valueBasis: _omitted, ...withoutBasis } = constraint;
      expect(() => hardConstraintSchema.parse(withoutBasis)).toThrow();
    }
  });

  it("references resource requirements without accepting duplicate required quantities", () => {
    for (const constraint of [validConstraints[0], validConstraints[3], validConstraints[6]]) {
      expect(() => hardConstraintSchema.parse({ ...constraint, requiredQuantity: { value: 5, unit: "hour" } })).toThrow();
    }
  });

  it("requires valid effective intervals and versioned policy identities", () => {
    const policy = validConstraints[4];
    expect(() => hardConstraintSchema.parse({ ...policy, rule: { ...policy.rule, version: "" } })).toThrow();
    expect(() => hardConstraintSchema.parse({ ...policy, rule: { ...policy.rule, effectiveUntil: "2025-01-01T00:00:00Z" } })).toThrow();
    expect(() => hardConstraintSchema.parse({ ...policy, expectedDecision: "MAYBE" })).toThrow();
  });

  it("rejects arbitrary custom payloads and recursively rejects outcome leakage", () => {
    expect(() => hardConstraintSchema.parse({ ...validConstraints[10], payload: { threshold: 5 } })).toThrow();
    for (const forbidden of [
      "winner", "lift", "significance", "posterior", "expectedRevenue",
      "expectedProfit", "expectedROAS", "expectedValue", "recommendationScore",
      "confidenceScore", "bestCandidate",
    ]) {
      expect(() => hardConstraintSchema.parse({ ...validConstraints[10], [forbidden]: 1 })).toThrow();
    }
  });
});

describe("hardConstraintsSchema", () => {
  it("accepts distinct definitions and rejects duplicate constraint ids", () => {
    expect(hardConstraintsSchema.parse(validConstraints)).toHaveLength(11);
    expect(() => hardConstraintsSchema.parse([validConstraints[0], validConstraints[0]])).toThrow(/Duplicate/);
  });
});
