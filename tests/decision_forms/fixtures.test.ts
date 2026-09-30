import { describe, expect, it } from "vitest";
import { decisionWhatSchema } from "../../src/decision_forms/index.js";
import {
  investigationExamples,
  noOpExamples,
} from "../../src/decision_forms/fixtures.js";
describe("standalone canonical examples", () => {
  for (const [name, what] of Object.entries({
    ...investigationExamples,
    ...noOpExamples,
  }))
    it(name, () =>
      expect(decisionWhatSchema.safeParse(what).success).toBe(true),
    );
  it("keeps custom taxonomy explicit and rejects a bare custom task", () => {
    expect(
      decisionWhatSchema.safeParse({
        ...investigationExamples.missingCogs,
        category: {
          kind: "CUSTOM",
          registryRef: "merchant-taxonomy",
          code: "supplier-audit",
        },
      }).success,
    ).toBe(true);
    expect(
      decisionWhatSchema.safeParse({
        ...investigationExamples.missingCogs,
        category: { kind: "CUSTOM", code: "supplier-audit" },
      }).success,
    ).toBe(false);
  });
  it("requires anomaly observations and tracking context", () => {
    const { observedAnomaly: _, ...anomaly } =
      investigationExamples.checkoutDecline;
    const { tracking: __, ...tracking } = investigationExamples.metaTracking;
    expect(decisionWhatSchema.safeParse(anomaly).success).toBe(false);
    expect(decisionWhatSchema.safeParse(tracking).success).toBe(false);
  });
  it("rejects state-changing fields on preservation and observation", () => {
    for (const field of [
      "freezeSimulator",
      "cancelExistingActions",
      "restoreBaseline",
      "setBudget",
      "population",
      "timing",
      "finding",
    ])
      expect(
        decisionWhatSchema.safeParse({ ...noOpExamples.global, [field]: true })
          .success,
      ).toBe(false);
  });
  it("rejects leakage at all investigation nested boundaries", () => {
    const base = investigationExamples.missingCogs;
    const variants = [
      { category: { ...base.category, expectedProfit: 10 } },
      {
        requiredEvidence: [
          { ...base.requiredEvidence[0], email: "a@example.com" },
        ],
      },
      {
        successCriteria: [
          { ...base.successCriteria[0], cause: "checkout-broken" },
        ],
      },
      {
        costs: {
          ...base.costs,
          analyst: { state: "UNKNOWN", expectedValue: 10 },
        },
      },
      { observationWindow: { ...base.observationWindow, confidenceScore: 1 } },
      { expectedDuration: { ...base.expectedDuration, predictedProfit: 1 } },
      {
        requiredResources: [
          {
            kind: "API_CALLS",
            quantity: 1,
            unit: "CALL",
            customerId: "raw-user",
          },
        ],
      },
    ];
    for (const v of variants)
      expect(decisionWhatSchema.safeParse({ ...base, ...v }).success).toBe(
        false,
      );
  });
});
