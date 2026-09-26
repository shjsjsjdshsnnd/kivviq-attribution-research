import { describe, expect, it } from "vitest";
import * as population from "../../src/population/index.js";
const base = {
  schemaVersion: 1,
  populationId: "population_a",
  version: 1,
  universe: "ALL_CUSTOMERS",
  inclusion: { kind: "COMPLETED_ORDER_COUNT", operator: "EQ", value: 1 },
  exclusions: [],
  membershipMode: "DYNAMIC_MEMBERSHIP",
  binding: "TRIGGER_TIME",
  provenance: ["evidence_fixture"],
};
const context = {
  evaluatedAt: "2026-09-26T12:00:00Z",
  customers: [
    { customerId: "customer_a", completedOrderCount: 1 },
    { customerId: "customer_b", completedOrderCount: 2 },
    { customerId: "customer_c" },
  ],
};
describe("population membership boundary", () => {
  it("provides independently reusable strict contracts", () => {
    expect(population).toHaveProperty("populationDefinitionSchema");
  });
  it("returns three membership states and evidence counts", () => {
    const r = population.evaluatePopulation(base, context);
    expect(r.members.map((x) => x.status)).toEqual([
      "ELIGIBLE",
      "INELIGIBLE",
      "UNKNOWN",
    ]);
    expect([
      r.eligibleCount,
      r.ineligibleCount,
      r.unknownCount,
      r.evidenceCoverage,
    ]).toEqual([1, 1, 1, 2 / 3]);
  });
  it.each([
    "score",
    "rank",
    "expectedLift",
    "expectedRevenue",
    "responseProbability",
    "expectedLTV",
    "recommendedTreatment",
    "bestAudience",
    "recommendationScore",
    "email",
    "phone",
    "name",
    "address",
  ])("rejects leaked %s at all boundaries", (field) => {
    expect(
      population.populationDefinitionSchema.safeParse({ ...base, [field]: 1 })
        .success,
    ).toBe(false);
    const r = population.evaluatePopulation(base, context);
    expect(
      population.populationEvaluationSchema.safeParse({ ...r, [field]: 1 })
        .success,
    ).toBe(false);
    expect(() =>
      population.evaluatePopulation(base, {
        ...context,
        customers: [{ customerId: "customer_a", [field]: 1 }],
      }),
    ).toThrow();
    const s = population.createPopulationSnapshot(base, r, {
      snapshotId: "snapshot_a",
    });
    expect(
      population.populationSnapshotSchema.safeParse({ ...s, [field]: 1 })
        .success,
    ).toBe(false);
  });
  it("fingerprints semantic identity independent of object key order", () => {
    const f = population.fingerprintPopulationDefinition(base);
    expect(
      population.fingerprintPopulationDefinition(
        Object.fromEntries(Object.entries(base).reverse()),
      ),
    ).toBe(f);
    for (const patch of [
      { binding: "SEND_TIME" },
      { membershipMode: "FROZEN_MEMBERSHIP" },
      {
        inclusion: { kind: "COMPLETED_ORDER_COUNT", operator: "GT", value: 1 },
      },
    ])
      expect(
        population.fingerprintPopulationDefinition({ ...base, ...patch }),
      ).not.toBe(f);
  });
  it("gives confirmed exclusion precedence over missing inclusion", () => {
    const r = population.evaluatePopulation(
      {
        ...base,
        exclusions: [{ kind: "CONSENT", channel: "SMS", eligible: true }],
      },
      {
        ...context,
        customers: [{ customerId: "customer_a", smsEligible: true }],
      },
    );
    expect(r.members[0]?.status).toBe("INELIGIBLE");
  });
  it.each(["AND", "INTERSECTION", "OR", "UNION", "NOT", "DIFFERENCE"])(
    "uses deterministic UNKNOWN logic for %s",
    (kind) => {
      const rule = { kind: "COMPLETED_ORDER_COUNT", operator: "EQ", value: 1 };
      const inclusion =
        kind === "NOT"
          ? { kind, operand: rule }
          : kind === "DIFFERENCE"
            ? { kind, left: rule, right: rule }
            : { kind, operands: [rule, rule] };
      expect(
        population.evaluatePopulation(
          { ...base, inclusion },
          { ...context, customers: [{ customerId: "customer_a" }] },
        ).unknownCount,
      ).toBe(1);
    },
  );
  it("does not substitute lifetime revenue for explicit window/currency", () => {
    const inclusion = {
      kind: "NET_REVENUE",
      operator: "GTE",
      amount: 500,
      currency: "CAD",
      window: { kind: "TRAILING_DAYS", days: 365 },
    };
    expect(
      population.evaluatePopulation(
        { ...base, inclusion },
        {
          ...context,
          customers: [
            {
              customerId: "customer_a",
              revenues: [
                { amount: 600, currency: "CAD", window: { kind: "LIFETIME" } },
              ],
            },
          ],
        },
      ).unknownCount,
    ).toBe(1);
    expect(
      population.fingerprintPopulationDefinition({ ...base, inclusion }),
    ).not.toBe(
      population.fingerprintPopulationDefinition({
        ...base,
        inclusion: { ...inclusion, window: { kind: "LIFETIME" } },
      }),
    );
  });
  it("preserves frozen snapshots separately from later evaluations", () => {
    const def = {
      ...base,
      membershipMode: "FROZEN_MEMBERSHIP",
      binding: "DECISION_TIME",
    };
    const first = population.evaluatePopulation(def, context);
    const s = population.createPopulationSnapshot(def, first, {
      snapshotId: "snapshot_a",
    });
    const later = population.evaluatePopulation(def, {
      ...context,
      evaluatedAt: "2026-09-27T12:00:00Z",
      customers: [{ customerId: "customer_a", completedOrderCount: 2 }],
    });
    expect(s.customerIds).toEqual(["customer_a"]);
    expect(later.eligibleCount).toBe(0);
    expect(Object.isFrozen(s)).toBe(true);
    expect(() =>
      population.createPopulationSnapshot({ ...def, version: 2 }, first, {
        snapshotId: "snapshot_b",
      }),
    ).toThrow();
  });
  it("rejects raw PII disguised as an identifier or provenance reference", () => {
    expect(() =>
      population.fingerprintPopulationDefinition({
        ...base,
        populationId: "person@example.com",
      }),
    ).toThrow();
    expect(() =>
      population.fingerprintPopulationDefinition({
        ...base,
        provenance: ["https://example.com/person@example.com"],
      }),
    ).toThrow();
  });
  it("provides fixtures 12 through 20", () => {
    expect(
      population.createPopulationFixtures().map((x) => x.fixtureNumber),
    ).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

it("exports a strict canonical population reference", () => {
  expect(population).toHaveProperty("populationReferenceSchema");
});
it("rejects ambiguous duplicate revenue observations", () => {
  expect(() =>
    population.evaluatePopulation(base, {
      ...context,
      customers: [
        {
          customerId: "customer_a",
          revenues: [
            { amount: 500, currency: "CAD", window: { kind: "LIFETIME" } },
            { amount: 600, currency: "CAD", window: { kind: "LIFETIME" } },
          ],
        },
      ],
    }),
  ).toThrow();
});
it.each(["AND", "OR", "INTERSECTION", "UNION", "DIFFERENCE"])(
  "evaluates complete truth tables for %s",
  (kind) => {
    const statuses = ["ELIGIBLE", "INELIGIBLE", "UNKNOWN"];
    for (const a of statuses)
      for (const b of statuses) {
        const left = { kind: "CONSENT", channel: "EMAIL", eligible: true },
          right = { kind: "CONSENT", channel: "SMS", eligible: true };
        const inclusion =
          kind === "DIFFERENCE"
            ? { kind, left, right }
            : { kind, operands: [left, right] };
        const c = {
          customerId: "customer_a",
          ...(a === "UNKNOWN" ? {} : { emailEligible: a === "ELIGIBLE" }),
          ...(b === "UNKNOWN" ? {} : { smsEligible: b === "ELIGIBLE" }),
        };
        const bv =
          kind === "DIFFERENCE"
            ? b === "UNKNOWN"
              ? b
              : b === "ELIGIBLE"
                ? "INELIGIBLE"
                : "ELIGIBLE"
            : b;
        const isAnd = ["AND", "INTERSECTION", "DIFFERENCE"].includes(kind);
        const expected = isAnd
          ? [a, bv].includes("INELIGIBLE")
            ? "INELIGIBLE"
            : [a, bv].includes("UNKNOWN")
              ? "UNKNOWN"
              : "ELIGIBLE"
          : [a, bv].includes("ELIGIBLE")
            ? "ELIGIBLE"
            : [a, bv].includes("UNKNOWN")
              ? "UNKNOWN"
              : "INELIGIBLE";
        expect(
          population.evaluatePopulation(
            { ...base, inclusion },
            { ...context, customers: [c] },
          ).members[0]?.status,
        ).toBe(expected);
      }
  },
);
it.each([
  "ALL_CUSTOMERS",
  "KNOWN_CUSTOMERS",
  "MARKETING_CONTACTS",
  "PURCHASERS",
  "EMAIL_ELIGIBLE_CUSTOMERS",
  "SMS_ELIGIBLE_CUSTOMERS",
])("evaluates the %s universe", (universe) => {
  expect(
    population.evaluatePopulation(
      { ...base, universe },
      {
        ...context,
        customers: [
          {
            customerId: "customer_a",
            completedOrderCount: 1,
            known: true,
            marketingContact: true,
            emailEligible: true,
            smsEligible: true,
          },
        ],
      },
    ).eligibleCount,
  ).toBe(1);
});
it("checks observed products and abandonment windows without inventing missing evidence", () => {
  for (const inclusion of [
    {
      kind: "PURCHASED_PRODUCT",
      productId: "product_a",
      window: { kind: "TRAILING_DAYS", days: 90 },
    },
    {
      kind: "OBSERVED_CART_ABANDONMENT",
      window: { kind: "TRAILING_DAYS", days: 90 },
    },
  ]) {
    const customers = [
      {
        customerId: "customer_a",
        purchases: [
          { productId: "product_a", completedAt: context.evaluatedAt },
        ],
        observedCartAbandonments: [context.evaluatedAt],
      },
      {
        customerId: "customer_b",
        purchaseEvidenceComplete: true,
        cartEvidenceComplete: true,
        purchases: [],
        observedCartAbandonments: [],
      },
      { customerId: "customer_c" },
    ];
    expect(
      population
        .evaluatePopulation({ ...base, inclusion }, { ...context, customers })
        .members.map((x) => x.status),
    ).toEqual(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]);
  }
});
it("fixtures have changing time counts and missing SMS consent", () => {
  const f = population.createPopulationFixtures();
  expect(
    f.find((x) => x.fixtureNumber === 17)?.evaluation.members[0]?.status,
  ).toBe("UNKNOWN");
  const changing = f.find((x) => x.fixtureNumber === 20)!;
  expect(changing.evaluation.eligibleCount).not.toBe(
    changing.laterEvaluation?.eligibleCount,
  );
});
it("does not reuse stale revenue summaries at a later evaluation time", () => {
  const inclusion = {
    kind: "NET_REVENUE",
    operator: "GTE",
    amount: 500,
    currency: "CAD",
    window: { kind: "TRAILING_DAYS", days: 365 },
  };
  expect(
    population.evaluatePopulation(
      { ...base, inclusion },
      {
        ...context,
        customers: [
          {
            customerId: "customer_a",
            revenues: [
              {
                amount: 600,
                currency: "CAD",
                window: { kind: "TRAILING_DAYS", days: 365 },
                asOf: "2026-09-25T12:00:00Z",
              },
            ],
          },
        ],
      },
    ).unknownCount,
  ).toBe(1);
});
it("ignores future observations", () => {
  const inclusion = {
    kind: "PURCHASED_PRODUCT",
    productId: "product_a",
    window: { kind: "LIFETIME" },
  };
  expect(
    population.evaluatePopulation(
      { ...base, inclusion },
      {
        ...context,
        customers: [
          {
            customerId: "customer_a",
            purchases: [
              { productId: "product_a", completedAt: "2026-10-01T12:00:00Z" },
            ],
          },
        ],
      },
    ).unknownCount,
  ).toBe(1);
});

it("validates reference identity and snapshot integrity", () => {
  const evaluation = population.evaluatePopulation(base, context);
  const reference = {
    populationId: evaluation.populationId,
    version: evaluation.version,
    definitionFingerprint: evaluation.definitionFingerprint,
    binding: evaluation.binding,
    membershipMode: evaluation.membershipMode,
  };
  expect(
    population.populationReferenceSchema.safeParse(reference).success,
  ).toBe(true);
  expect(
    population.populationReferenceSchema.safeParse({ ...reference, score: 1 })
      .success,
  ).toBe(false);
  const snapshot = population.createPopulationSnapshot(base, evaluation, {
    snapshotId: "snapshot_a",
  });
  expect(
    population.populationSnapshotSchema.safeParse({
      ...snapshot,
      customerIds: ["customer_b"],
    }).success,
  ).toBe(false);
  for (const patch of [
    { binding: "SEND_TIME" },
    { membershipMode: "FROZEN_MEMBERSHIP" },
    { populationId: "population_b" },
  ])
    expect(() =>
      population.createPopulationSnapshot({ ...base, ...patch }, evaluation, {
        snapshotId: "snapshot_b",
      }),
    ).toThrow();
});
it("only consumes revenue summaries observed at the evaluation instant", () => {
  const inclusion = {
    kind: "NET_REVENUE",
    operator: "GTE",
    amount: 500,
    currency: "CAD",
    window: { kind: "TRAILING_DAYS", days: 365 },
  };
  const evidence = {
    asOf: context.evaluatedAt,
    amount: 600,
    currency: "CAD",
    window: { kind: "TRAILING_DAYS", days: 365 },
  };
  expect(
    population.evaluatePopulation(
      { ...base, inclusion },
      {
        ...context,
        customers: [{ customerId: "customer_a", revenues: [evidence] }],
      },
    ).eligibleCount,
  ).toBe(1);
  expect(
    population.evaluatePopulation(
      { ...base, inclusion },
      {
        ...context,
        customers: [
          {
            customerId: "customer_a",
            revenues: [{ ...evidence, currency: "USD" }],
          },
        ],
      },
    ).unknownCount,
  ).toBe(1);
});
it("rejects nested leakage, duplicate identities and forged counts", () => {
  expect(
    population.populationDefinitionSchema.safeParse({
      ...base,
      inclusion: { ...base.inclusion, responseProbability: 0.5 },
    }).success,
  ).toBe(false);
  expect(() =>
    population.evaluatePopulation(base, {
      ...context,
      customers: [context.customers[0], context.customers[0]],
    }),
  ).toThrow();
  const evaluation = population.evaluatePopulation(base, context);
  expect(
    population.populationEvaluationSchema.safeParse({
      ...evaluation,
      eligibleCount: 100,
    }).success,
  ).toBe(false);
  expect(
    population.populationEvaluationSchema.safeParse({
      ...evaluation,
      members: [
        {
          customerId: "customer_a",
          status: "ELIGIBLE",
          email: "person@example.com",
        },
      ],
    }).success,
  ).toBe(false);
});
