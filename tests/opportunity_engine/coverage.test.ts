import { describe, expect, it } from "vitest";
import { assessOpportunityCoverage, validateTemplateCoverage } from "../../src/opportunity_engine/coverage.js";
import { generateOpportunities } from "../../src/opportunity_engine/generator.js";
import { makeSnapshot } from "./fixture.js";

describe("Opportunity action-space coverage", () => {
  it("has candidate templates beyond ads and discounts across the required intervention families", () => {
    const report = validateTemplateCoverage();
    expect(report.missingDomains).toEqual([]);
    expect(report.coveredDomains).toContain("CRO");
    expect(report.coveredDomains).toContain("RETENTION");
    expect(report.coveredDomains).toContain("MERCHANDISING");
    expect(report.coveredDomains).toContain("INVENTORY");
    expect(report.coveredDomains).toContain("OPERATIONAL");
  });

  it("surfaces a diversified candidate set when a simulated merchant presents cross-domain issues", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({
        signals: [
          "margin_compression",
          "discount_driven_growth",
          "retargeting_heavy",
          "inventory_constrained",
          "retention_weak",
          "measurement_confidence_low",
        ],
        metricPatches: {
          product_momentum: { trend: "RISING" },
          automation_coverage: { current: 0.2 },
          shipping_fulfillment_cost: { trend: "RISING" },
          return_rate: { trend: "RISING" },
          inventory_at_risk_value: { current: 10000 },
        },
      }),
      diagnosis: {
        merchantId: "merchant-1",
        changes: [{ id: "change:cvr", metricId: "cvr", status: "material", delta: -0.02, evidenceIds: ["diag.cvr"] }],
        unknowns: [],
      },
    });
    const report = assessOpportunityCoverage(result.opportunities);
    expect(report.coveredDomains).toContain("PAID_MEDIA");
    expect(report.coveredDomains).toContain("PRICING");
    expect(report.coveredDomains).toContain("PROMOTION");
    expect(report.coveredDomains).toContain("CRO");
    expect(report.coveredDomains).toContain("MERCHANDISING");
    expect(report.coveredDomains).toContain("INVENTORY");
    expect(report.coveredDomains).toContain("RETENTION");
    expect(report.coveredDomains).toContain("SHIPPING");
    expect(report.coveredDomains).toContain("OPERATIONAL");
    expect(report.overConcentration).toEqual([]);
  });
});
