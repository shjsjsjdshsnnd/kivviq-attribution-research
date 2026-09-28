import { describe, expect, it } from "vitest";
import {
  actionCharacteristicsSchema,
  assertReachableCancellationStages,
  costLineItemSchema,
  operationalQuantitySchema,
  operationalQuantityValueSchema,
  reversibilitySchema,
} from "../../src/action_characteristics/index.js";

const money = (amountMinor: number, currency = "USD") => ({ amountMinor, currency });
const cost = (lineItemId: string, amountMinor = 100) => ({
  lineItemId,
  category: "LABOR" as const,
  amount: { state: "KNOWN" as const, value: money(amountMinor) },
});
const burden = {
  burdenId: "burden.growth_team",
  amount: {
    state: "KNOWN" as const,
    value: {
      quantity: 2,
      unit: "hours" as const,
      resource: { kind: "STAFF" as const, resourceRef: "team.growth" },
    },
  },
};
const burdenValue = {
    quantity: 2,
    unit: "hours" as const,
    resource: { kind: "STAFF" as const, resourceRef: "team.growth" },
};
const stage = (name: "BEFORE_START" | "IMPLEMENTING" | "COMMITTED" | "EFFECTIVE" | "COMPLETED") => ({
  stage: name,
  cancellationAvailable: name === "BEFORE_START" || name === "IMPLEMENTING",
  cancellationCost:
    name === "BEFORE_START" || name === "IMPLEMENTING" ? [cost(`cancel.${name}`)] : [],
  compensationCost:
    name === "COMMITTED" || name === "EFFECTIVE" || name === "COMPLETED" ? [cost(`compensate.${name}`)] : [],
  operationalBurden: [burden],
});

const base = {
  implementationCost: [cost("implementation")],
  reversibility: {
    kind: "FULLY_REVERSIBLE" as const,
    reversal: {
      kind: "ACTION" as const,
      actionId: "action_restore_price",
      actionFingerprint: "fnv1a64:0123456789abcdef",
    },
  },
  cancellationCosts: [stage("BEFORE_START"), stage("IMPLEMENTING"), stage("EFFECTIVE"), stage("COMPLETED")],
  operationalBurden: [burden],
};

const reachabilityFixtures = {
  INSTANTANEOUS_SEND: {
    input: { kind: "INSTANTANEOUS_SEND" as const },
    stages: ["BEFORE_START", "EFFECTIVE", "COMPLETED"] as const,
  },
  PERSISTENT_POLICY: {
    input: { kind: "PERSISTENT_POLICY" as const, hasExplicitCompletion: false },
    stages: ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE"] as const,
  },
  TEMPORARY_PRICE: {
    input: {
      kind: "TEMPORARY_PRICE" as const,
      implementationPrecedesEffect: true as const,
      hasFiniteCompletion: true as const,
    },
    stages: ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE", "COMPLETED"] as const,
  },
  COMMITTED_INVENTORY_PURCHASE: {
    input: {
      kind: "COMMITTED_INVENTORY_PURCHASE" as const,
      commitmentOccursDuringImplementation: true as const,
      hasCompletion: true,
    },
    stages: ["BEFORE_START", "IMPLEMENTING", "COMMITTED", "EFFECTIVE", "COMPLETED"] as const,
  },
};

describe("action characteristic value contracts", () => {
  it("keeps known, range, unknown, and not-applicable states distinct", () => {
    expect(operationalQuantitySchema.parse(burden.amount).state).toBe("KNOWN");
    expect(operationalQuantitySchema.parse({ state: "UNKNOWN", reason: "staffing not scheduled" }).state).toBe("UNKNOWN");
    expect(operationalQuantitySchema.parse({ state: "NOT_APPLICABLE", reason: "no operational work" }).state).toBe("NOT_APPLICABLE");
    expect(operationalQuantitySchema.safeParse({ state: "UNKNOWN", reason: "" }).success).toBe(false);
  });

  it("requires integer minor-unit money and currency-consistent ordered ranges", () => {
    expect(costLineItemSchema.safeParse(cost("valid")).success).toBe(true);
    expect(costLineItemSchema.safeParse({ ...cost("fraction"), amount: { state: "KNOWN", value: money(1.5) } }).success).toBe(false);
    expect(costLineItemSchema.safeParse({ ...cost("currency"), amount: { state: "KNOWN", value: money(1, "usd") } }).success).toBe(false);
    expect(costLineItemSchema.safeParse({
      ...cost("range"),
      amount: { state: "RANGE", minimum: money(200), maximum: money(100) },
    }).success).toBe(false);
    expect(costLineItemSchema.safeParse({
      ...cost("range"),
      amount: { state: "RANGE", minimum: money(100, "USD"), maximum: money(200, "CAD") },
    }).success).toBe(false);
  });

  it("requires finite non-negative quantities with controlled units and exact resources", () => {
    expect(operationalQuantityValueSchema.safeParse(burdenValue).success).toBe(true);
    expect(operationalQuantityValueSchema.safeParse({ ...burdenValue, quantity: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    expect(operationalQuantityValueSchema.safeParse({ ...burdenValue, quantity: -1 }).success).toBe(false);
    expect(operationalQuantityValueSchema.safeParse({ ...burdenValue, quantity: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(operationalQuantityValueSchema.safeParse({ ...burdenValue, unit: "clicks" }).success).toBe(false);
    expect(operationalQuantityValueSchema.safeParse({
      quantity: 1,
      unit: { registryRef: "units.ops", code: "pallet", version: "2" },
      resource: { kind: "CUSTOM", registryRef: "resources.ops", code: "dock", version: "4" },
    }).success).toBe(true);
    expect(operationalQuantitySchema.safeParse({
      state: "RANGE",
      minimum: burdenValue,
      maximum: { ...burdenValue, quantity: 1 },
    }).success).toBe(false);
    expect(operationalQuantitySchema.safeParse({
      state: "RANGE",
      minimum: burdenValue,
      maximum: { ...burdenValue, quantity: Number.MAX_SAFE_INTEGER + 1 },
    }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({
      ...base,
      operationalBurden: [{ burdenId: "burden.range", amount: {
        state: "RANGE", minimum: burdenValue, maximum: { ...burdenValue, quantity: 1 },
      } }],
    }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({
      ...base,
      operationalBurden: [{ burdenId: "burden.range", amount: {
        state: "RANGE", minimum: burdenValue,
        maximum: { ...burdenValue, resource: { kind: "STAFF", resourceRef: "team.other" } },
      } }],
    }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({
      ...base,
      operationalBurden: [burden, burden],
    }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({
      ...base,
      cancellationCosts: [{ ...stage("BEFORE_START"), operationalBurden: [burden, burden] }],
    }).success).toBe(false);
  });
});

describe("strict reversibility", () => {
  it("requires exact or versioned reversal references and typed irreversible effects", () => {
    expect(reversibilitySchema.safeParse(base.reversibility).success).toBe(true);
    expect(reversibilitySchema.safeParse({ kind: "FULLY_REVERSIBLE", reversal: { kind: "ACTION", actionId: "action_restore_price" } }).success).toBe(false);
    expect(reversibilitySchema.safeParse({ kind: "PARTIALLY_REVERSIBLE", reversal: base.reversibility.reversal, irreversibleEffects: [] }).success).toBe(false);
    expect(reversibilitySchema.safeParse({
      kind: "PARTIALLY_REVERSIBLE",
      reversal: { kind: "REGISTERED", registryRef: "rollback.pricing", code: "restore", version: "1" },
      irreversibleEffects: [{ kind: "CUSTOMER_EXPOSED", populationRef: "population.checkout" }],
    }).success).toBe(true);
    expect(reversibilitySchema.safeParse({ kind: "IRREVERSIBLE", irreversibleEffects: [] }).success).toBe(false);
    expect(reversibilitySchema.safeParse({ kind: "UNKNOWN", reason: "" }).success).toBe(false);
    expect(reversibilitySchema.safeParse({ kind: "NOT_APPLICABLE", reason: "no implemented state" }).success).toBe(true);
  });
});

describe("stage-sensitive cancellation and compensation", () => {
  it("rejects duplicate stages, duplicate line items, and cancellation costs after cancellation ends", () => {
    expect(actionCharacteristicsSchema.safeParse(base).success).toBe(true);
    expect(actionCharacteristicsSchema.safeParse({ ...base, cancellationCosts: [stage("BEFORE_START"), stage("BEFORE_START")] }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({ ...base, implementationCost: [cost("same"), cost("same")] }).success).toBe(false);
    expect(actionCharacteristicsSchema.safeParse({
      ...base,
      cancellationCosts: [{ ...stage("EFFECTIVE"), cancellationCost: [cost("invalid")] }],
    }).success).toBe(false);
  });

  it("derives the exact reachable stages for all four domain profiles", () => {
    for (const fixture of Object.values(reachabilityFixtures)) {
      const characteristics = {
        ...base,
        cancellationCosts: fixture.stages.map(stage),
      };
      expect(() => assertReachableCancellationStages(fixture.input, characteristics)).not.toThrow();
    }
    expect(() => assertReachableCancellationStages(
      reachabilityFixtures.INSTANTANEOUS_SEND.input,
      base,
    )).toThrow(/reachable stages/i);
  });

  it("keeps cancellation and compensation stage-sensitive in the fixtures", () => {
    const send = reachabilityFixtures.INSTANTANEOUS_SEND.stages.map(stage);
    expect(send.some(({ stage }) => stage === "IMPLEMENTING")).toBe(false);
    expect(send.find(({ stage }) => stage === "EFFECTIVE")?.cancellationAvailable).toBe(false);
    expect(send.find(({ stage }) => stage === "EFFECTIVE")?.compensationCost.length).toBeGreaterThan(0);
    const inventory = reachabilityFixtures.COMMITTED_INVENTORY_PURCHASE.stages.map(stage);
    expect(inventory.find(({ stage }) => stage === "IMPLEMENTING")?.cancellationAvailable).toBe(true);
    expect(inventory.find(({ stage }) => stage === "COMMITTED")?.cancellationAvailable).toBe(false);
    expect(inventory.find(({ stage }) => stage === "COMMITTED")?.compensationCost.length).toBeGreaterThan(0);
    expect(inventory.find(({ stage }) => stage === "EFFECTIVE")?.cancellationAvailable).toBe(false);
  });

  it("rejects cancellation availability that contradicts the domain stage", () => {
    const characteristics = {
      ...base,
      cancellationCosts: reachabilityFixtures.INSTANTANEOUS_SEND.stages.map(stage).map((entry) =>
        entry.stage === "EFFECTIVE"
          ? { ...entry, cancellationAvailable: true, compensationCost: [] }
          : entry,
      ),
    };
    expect(() => assertReachableCancellationStages(
      reachabilityFixtures.INSTANTANEOUS_SEND.input,
      characteristics,
    )).toThrow(/cancellation availability/i);
  });
});

describe("definition purity and delay authority", () => {
  it.each(["delay", "leadTime", "implementationDelaySeconds", "implementationDelay"])(
    "rejects a nested %s field",
    (key) => {
      expect(actionCharacteristicsSchema.safeParse({
        ...base,
        operationalBurden: [{
          ...burden,
          amount: {
            ...burden.amount,
            value: { ...burden.amount.value, [key]: 4 },
          },
        }],
      }).success).toBe(false);
    },
  );

  it.each(["sourceRef", "sourceRefs", "evidenceRef", "provenance"])(
    "rejects definition evidence field %s",
    (key) => {
      expect(actionCharacteristicsSchema.safeParse({ ...base, [key]: "receipt.input" }).success).toBe(false);
    },
  );
});
