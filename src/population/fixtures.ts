import { populationDefinitionSchema } from "./schema.js";
import type { PopulationDefinition, PopulationContext } from "./schema.js";
import { evaluatePopulation } from "./evaluation.js";
export function createPopulationFixtures() {
  const base: PopulationDefinition = {
    schemaVersion: 1,
    populationId: "population_fixture",
    version: 1,
    universe: "ALL_CUSTOMERS",
    inclusion: { kind: "COMPLETED_ORDER_COUNT", operator: "EQ", value: 1 },
    exclusions: [],
    membershipMode: "DYNAMIC_MEMBERSHIP",
    binding: "TRIGGER_TIME",
    provenance: ["evidence_fixture"],
  };
  const context: PopulationContext = {
    evaluatedAt: "2026-09-26T12:00:00Z",
    customers: [
      {
        customerId: "customer_a",
        completedOrderCount: 1,
        lastCompletedOrderAt: "2026-06-01T12:00:00Z",
        emailEligible: true,
        revenues: [
          {
            asOf: "2026-09-26T12:00:00Z",
            amount: 600,
            currency: "CAD",
            window: { kind: "TRAILING_DAYS", days: 365 },
          },
        ],
        purchases: [
          { productId: "product_a", completedAt: "2026-09-01T12:00:00Z" },
        ],
        observedCartAbandonments: ["2026-09-25T12:00:00Z"],
      },
      { customerId: "customer_b", completedOrderCount: 2, smsEligible: false },
    ],
  };
  const defs: PopulationDefinition[] = [
    base,
    {
      ...base,
      inclusion: {
        kind: "AND",
        operands: [
          { kind: "COMPLETED_ORDER_COUNT", operator: "GTE", value: 2 },
          {
            kind: "NET_REVENUE",
            operator: "GTE",
            amount: 500,
            currency: "CAD",
            window: { kind: "TRAILING_DAYS", days: 365 },
          },
        ],
      },
    },
    {
      ...base,
      inclusion: {
        kind: "PURCHASED_PRODUCT",
        productId: "product_a",
        window: { kind: "TRAILING_DAYS", days: 90 },
      },
    },
    {
      ...base,
      inclusion: {
        kind: "OBSERVED_CART_ABANDONMENT",
        window: { kind: "TRAILING_DAYS", days: 7 },
      },
    },
    {
      ...base,
      exclusions: [
        { kind: "DAYS_SINCE_LAST_COMPLETED_ORDER", operator: "LT", value: 30 },
      ],
    },
    { ...base, inclusion: { kind: "CONSENT", channel: "SMS", eligible: true } },
    { ...base, membershipMode: "FROZEN_MEMBERSHIP", binding: "DECISION_TIME" },
    base,
    {
      ...base,
      inclusion: {
        kind: "DAYS_SINCE_LAST_COMPLETED_ORDER",
        operator: "GTE",
        value: 120,
      },
    },
  ];
  return defs.map((definition, i) => ({
    fixtureNumber: i + 12,
    definition: populationDefinitionSchema.parse(definition),
    context,
    evaluation: evaluatePopulation(definition, context),
    ...(i === 8
      ? {
          laterEvaluation: evaluatePopulation(definition, {
            ...context,
            evaluatedAt: "2026-10-26T12:00:00Z",
          }),
        }
      : {}),
  }));
}
