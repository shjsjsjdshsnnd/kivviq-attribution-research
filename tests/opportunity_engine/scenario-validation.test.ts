import { describe, expect, it } from "vitest";
import { validateOpportunityScenarioSuite } from "../../src/opportunity_engine/scenario-validation.js";
import { makeSnapshot } from "./fixture.js";

describe("Opportunity candidate-set validation", () => {
  it("measures candidate recall against evaluator-only known intervention sets", () => {
    const suite = validateOpportunityScenarioSuite([
      {
        scenarioId: "checkout-deterioration",
        operatorInput: {
          snapshot: makeSnapshot(),
          diagnosis: {
            merchantId: "merchant-1",
            changes: [{ id: "change:cvr", metricId: "cvr", status: "material", delta: -0.03, evidenceIds: ["diag.cvr"] }],
            unknowns: [],
          },
        },
        expectedTemplateIds: ["cro.checkout_fix", "cro.checkout_experiment"],
        forbiddenTemplateIds: ["promotion.reduce_discount"],
      },
      {
        scenarioId: "inventory-shortage",
        operatorInput: { snapshot: makeSnapshot({ signals: ["inventory_constrained"] }) },
        expectedTemplateIds: ["inventory.reorder", "inventory.protect"],
        forbiddenTemplateIds: ["paid.scale_incremental"],
      },
      {
        scenarioId: "margin-promo-trap",
        operatorInput: { snapshot: makeSnapshot({ signals: ["margin_compression", "discount_driven_growth"] }) },
        expectedTemplateIds: ["promotion.reduce_discount", "pricing.test_price", "merch.feature_high_margin"],
      },
    ]);
    expect(suite.passed).toBe(true);
    expect(suite.meanCandidateRecall).toBe(1);
  });
});
