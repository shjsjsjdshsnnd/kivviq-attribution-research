import { describe, expect, it } from "vitest";
import {
  actionRiskMeasurementContractsSchema,
  riskMeasurementContractSchema,
} from "../../src/action_risk/index.js";

const sourceDefinitionRef = {
  registryRef: "risk.source.registry",
  code: "merchant_ledger",
  version: "1.0",
} as const;

const common = {
  horizon: { amount: 30, unit: "DAY" as const },
  aggregation: "INTERVAL" as const,
  evidencePolicyRef: "evidence.policy.observed",
  sourceDefinitionRef,
};

const population = {
  populationId: "population_all_customers",
  version: 1,
  definitionFingerprint: "fnv1a64:0123456789abcdef",
  binding: "DECISION_TIME" as const,
  membershipMode: "FROZEN_MEMBERSHIP" as const,
  snapshotRef: "snapshot_all_customers",
};

const valid = {
  FINANCIAL_DOWNSIDE: [
    {
      ...common,
      measurementId: "risk.financial.loss",
      metricRef: "metric.financial.loss",
      dimension: "FINANCIAL_DOWNSIDE" as const,
      target: { kind: "PRODUCT" as const, ref: "product.alpha" },
      valueType: { kind: "MONEY" as const, currency: "USD" },
      lossBaselineRef: "baseline.financial.pre_action",
    },
  ],
  IRREVERSIBILITY: [
    {
      ...common,
      measurementId: "risk.irreversibility.exposure",
      metricRef: "metric.irreversible.customers",
      dimension: "IRREVERSIBILITY" as const,
      target: { kind: "POPULATION" as const, ref: "population.all" },
      valueType: { kind: "QUANTITY" as const, unit: "customers" as const },
      reversibilityContractRef: "characteristics.reversibility.primary",
      irreversibleEffectKinds: ["CUSTOMER_EXPOSED" as const],
      restorationCriterionRef: "criterion.customer.restored",
    },
  ],
  UNCERTAINTY: [
    {
      ...common,
      measurementId: "risk.uncertainty.response",
      metricRef: "metric.response.uncertainty",
      dimension: "UNCERTAINTY" as const,
      target: { kind: "CAMPAIGN" as const, ref: "campaign.alpha" },
      valueType: { kind: "PERCENTAGE" as const },
      uncertainQuantityRef: "quantity.incremental.orders",
      uncertaintySource: {
        kind: "PARAMETER_METRIC" as const,
        parameterRef: "parameter.response_rate",
        metricRef: "metric.response_rate",
      },
    },
  ],
  INVENTORY_EXPOSURE: [
    {
      ...common,
      measurementId: "risk.inventory.units",
      metricRef: "metric.inventory.exposure",
      dimension: "INVENTORY_EXPOSURE" as const,
      inventoryTarget: {
        productRef: "product.alpha",
        variantRef: "variant.blue",
        locationRef: "warehouse.east",
      },
      valueType: { kind: "QUANTITY" as const, unit: "units" as const },
    },
  ],
  CUSTOMER_IMPACT: [
    {
      ...common,
      measurementId: "risk.customer.disruption",
      metricRef: "metric.customer.disruption",
      dimension: "CUSTOMER_IMPACT" as const,
      population,
      impactFamily: {
        registryRef: "risk.customer.impact",
        code: "checkout_disruption",
        version: "1",
      },
      valueType: { kind: "QUANTITY" as const, unit: "customers" as const },
    },
  ],
  TIME_TO_RECOVERY: [
    {
      ...common,
      measurementId: "risk.recovery.duration",
      metricRef: "metric.recovery.duration",
      dimension: "TIME_TO_RECOVERY" as const,
      target: { kind: "GLOBAL" as const },
      recoveryBaselineRef: "baseline.checkout.pre_action",
      recoveryCriterionRef: "criterion.checkout.restored",
      startBoundary: "DOWNSIDE_OBSERVED" as const,
      valueType: { kind: "DURATION" as const, unit: "HOUR" as const },
    },
  ],
};

describe("action risk measurement contracts", () => {
  it("accepts exactly six non-empty dimension-specific measurement vectors", () => {
    expect(actionRiskMeasurementContractsSchema.parse(valid)).toEqual(valid);
    expect(() =>
      actionRiskMeasurementContractsSchema.parse({
        ...valid,
        TIME_TO_RECOVERY: [],
      }),
    ).toThrow();
    expect(() => {
      const { CUSTOMER_IMPACT: _omitted, ...missing } = valid;
      actionRiskMeasurementContractsSchema.parse(missing);
    }).toThrow();
    expect(() =>
      actionRiskMeasurementContractsSchema.parse({ ...valid, OTHER: [] }),
    ).toThrow();
  });

  it("rejects duplicate measurement IDs across dimensions", () => {
    expect(() =>
      actionRiskMeasurementContractsSchema.parse({
        ...valid,
        CUSTOMER_IMPACT: [
          {
            ...valid.CUSTOMER_IMPACT[0],
            measurementId: valid.FINANCIAL_DOWNSIDE[0]!.measurementId,
          },
        ],
      }),
    ).toThrow(/Duplicate risk measurement ID/);
  });

  it("enforces common contract identity, horizon, aggregation and source references", () => {
    const financial = valid.FINANCIAL_DOWNSIDE[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...financial, horizon: { amount: 0, unit: "DAY" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...financial, horizon: { amount: 1.5, unit: "DAY" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...financial, horizon: { amount: Number.MAX_SAFE_INTEGER + 1, unit: "DAY" } })).toThrow();
    expect(
      riskMeasurementContractSchema.parse({
        ...financial,
        horizon: { amount: Number.MAX_SAFE_INTEGER, unit: "DAY" },
      }).horizon.amount,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => riskMeasurementContractSchema.parse({ ...financial, aggregation: "AVERAGE" })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...financial, evidencePolicyRef: "free text" })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...financial, sourceDefinitionRef: { registryRef: "risk.registry", code: "ledger" } })).toThrow();
  });

  it("requires a currency-bound financial loss baseline", () => {
    const financial = valid.FINANCIAL_DOWNSIDE[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...financial, valueType: { kind: "MONEY", currency: "usd" } })).toThrow();
    expect(() => {
      const { lossBaselineRef: _omitted, ...missing } = financial;
      riskMeasurementContractSchema.parse(missing);
    }).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...financial, valueType: { kind: "PERCENTAGE" } })).toThrow();
  });

  it("binds irreversibility to characteristics, effects and restoration", () => {
    const irreversible = valid.IRREVERSIBILITY[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...irreversible, irreversibleEffectKinds: [] })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...irreversible, irreversibleEffectKinds: ["MADE_UP_EFFECT"] })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...irreversible, irreversibleEffectKinds: ["CUSTOMER_EXPOSED", "CUSTOMER_EXPOSED"] })).toThrow(/Duplicate/);
    expect(() => riskMeasurementContractSchema.parse({ ...irreversible, valueType: { kind: "MONEY", currency: "USD" } })).toThrow();
    expect(() => {
      const { restorationCriterionRef: _omitted, ...missing } = irreversible;
      riskMeasurementContractSchema.parse(missing);
    }).toThrow();
  });

  it("accepts only parameter-metric or versioned custom uncertainty sources", () => {
    const uncertainty = valid.UNCERTAINTY[0]!;
    expect(
      riskMeasurementContractSchema.parse({
        ...uncertainty,
        valueType: {
          kind: "SCALAR",
          unit: { registryRef: "risk.units", code: "standard_error", version: "1" },
        },
        uncertaintySource: {
          kind: "CUSTOM",
          registryRef: "risk.uncertainty",
          code: "posterior_spread_contract",
          version: "2",
        },
      }).dimension,
    ).toBe("UNCERTAINTY");
    expect(() => riskMeasurementContractSchema.parse({ ...uncertainty, uncertaintySource: { kind: "MODEL", modelRef: "model.x" } })).toThrow();
  });

  it("specializes inventory targets and value types", () => {
    const inventory = valid.INVENTORY_EXPOSURE[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...inventory, target: { kind: "PRODUCT", ref: "product.alpha" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...inventory, inventoryTarget: { productRef: "bad ref" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...inventory, valueType: { kind: "PERCENTAGE" } })).toThrow();
    expect(
      riskMeasurementContractSchema.parse({
        ...inventory,
        valueType: {
          kind: "QUANTITY",
          unit: { registryRef: "inventory.units", code: "cases", version: "1" },
        },
      }).dimension,
    ).toBe("INVENTORY_EXPOSURE");
  });

  it("requires an exact customer population and versioned impact family", () => {
    const customer = valid.CUSTOMER_IMPACT[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...customer, target: { kind: "POPULATION", ref: "population.all" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...customer, population: { populationId: "population_all_customers" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...customer, impactFamily: { registryRef: "risk.impact", code: "harm" } })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...customer, valueType: { kind: "QUANTITY", unit: "orders" } })).toThrow();
  });

  it("requires recovery baseline, criterion, start boundary and duration unit", () => {
    const recovery = valid.TIME_TO_RECOVERY[0]!;
    expect(() => riskMeasurementContractSchema.parse({ ...recovery, startBoundary: "ACTION_CANCELLED" })).toThrow();
    expect(() => riskMeasurementContractSchema.parse({ ...recovery, valueType: { kind: "DURATION", unit: "WEEK" } })).toThrow();
    expect(() => {
      const { recoveryCriterionRef: _omitted, ...missing } = recovery;
      riskMeasurementContractSchema.parse(missing);
    }).toThrow();
  });

  it("rejects valid measurements relabeled as another dimension", () => {
    expect(() =>
      riskMeasurementContractSchema.parse({
        ...valid.FINANCIAL_DOWNSIDE[0]!,
        dimension: "IRREVERSIBILITY",
      }),
    ).toThrow();
    expect(() =>
      riskMeasurementContractSchema.parse({
        ...valid.CUSTOMER_IMPACT[0]!,
        dimension: "INVENTORY_EXPOSURE",
      }),
    ).toThrow();
    expect(() =>
      riskMeasurementContractSchema.parse({
        ...valid.TIME_TO_RECOVERY[0]!,
        dimension: "UNCERTAINTY",
      }),
    ).toThrow();
  });

  it("reports cyclic adversarial input without overflowing", () => {
    const cyclic: Record<string, unknown> = { ...valid.FINANCIAL_DOWNSIDE[0]! };
    cyclic["cycle"] = cyclic;
    expect(() => riskMeasurementContractSchema.parse(cyclic)).toThrow(/cyclic/i);
  });

  it("reports excessively deep adversarial input without overflowing", () => {
    const deep: Record<string, unknown> = { leaf: true };
    let cursor = deep;
    for (let depth = 0; depth < 80; depth += 1) {
      const nested: Record<string, unknown> = {};
      cursor["nested"] = nested;
      cursor = nested;
    }
    expect(() =>
      riskMeasurementContractSchema.parse({
        ...valid.FINANCIAL_DOWNSIDE[0]!,
        adversarial: deep,
      }),
    ).toThrow(/depth|complex/i);
  });

  it("bounds adversarial input breadth", () => {
    expect(() =>
      riskMeasurementContractSchema.parse({
        ...valid.FINANCIAL_DOWNSIDE[0]!,
        adversarial: Array.from({ length: 10_001 }, () => ({})),
      }),
    ).toThrow(/complex/i);
  });

  it.each([
    "value",
    "score",
    "rating",
    "grade",
    "probability",
    "prediction",
    "expectedLoss",
    "confidence",
    "weight",
    "rank",
    "recommendation",
    "compositeRisk",
    "estimated_value",
    "outcomes",
  ])("recursively rejects leaked %s fields", (field) => {
    const contaminated = structuredClone(valid) as Record<string, unknown>;
    const financial = (contaminated["FINANCIAL_DOWNSIDE"] as Record<string, unknown>[])[0];
    financial!["sourceDefinitionRef"] = {
      ...sourceDefinitionRef,
      nested: { [field]: 0.9 },
    };
    expect(() => actionRiskMeasurementContractsSchema.parse(contaminated)).toThrow(/forbidden/i);
  });
});
