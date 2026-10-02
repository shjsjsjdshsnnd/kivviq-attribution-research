import { describe, expect, it } from "vitest";
import { compileOpportunityToSimulator } from "../../src/opportunity_engine/compile.js";
import { generateOpportunities } from "../../src/opportunity_engine/generator.js";
import { buildOpportunityPortfolio, generateOpportunityPortfolios } from "../../src/opportunity_engine/portfolio.js";
import { causalCheckoutEvidence, makeSnapshot } from "./fixture.js";

const diagnosis = {
  merchantId: "merchant-1",
  status: "diagnosed",
  changes: [
    { id: "change:cvr", metricId: "cvr", status: "material", reference: 0.12, current: 0.1, delta: -0.02, relativeDelta: -0.1667, evidenceIds: ["diag.cvr"] },
    { id: "change:sessions", metricId: "sessions", status: "material", reference: 1200, current: 1000, delta: -200, relativeDelta: -0.1667, evidenceIds: ["diag.sessions"] },
  ],
  unknowns: [],
};

describe("Step 6 Opportunity Engine", () => {
  it("converts diagnoses into multiple candidate interventions and always retains no-action", () => {
    const result = generateOpportunities({ snapshot: makeSnapshot(), diagnosis });
    expect(result.areas.map((item) => item.code)).toContain("conversion_decline");
    expect(result.areas.map((item) => item.code)).toContain("traffic_decline");
    expect(result.opportunities.filter((item) => item.areaId === "area_conversion_decline").length).toBeGreaterThanOrEqual(2);
    expect(result.opportunities.some((item) => item.status === "NO_ACTION")).toBe(true);
    expect(result.opportunities.filter((item) => item.status !== "NO_ACTION").every((item) => item.impact.contributionProfit.state === "UNKNOWN")).toBe(true);
  });

  it("becomes actionable only with target, parameters, capability, and causal impact evidence", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot(),
      diagnosis,
      supportedActionTypes: ["cro.modify_checkout"],
      candidateHints: [{
        templateId: "cro.checkout_fix",
        parameters: { change_ref: "checkout-v2" },
        requiredResources: ["engineering.checkout"],
      }],
      estimateEvidence: [causalCheckoutEvidence],
    });
    const checkout = result.opportunities.find((item) => item.intervention.templateId === "cro.checkout_fix")!;
    expect(checkout.status).toBe("ACTIONABLE");
    expect(checkout.intervention.target).toEqual({ state: "RESOLVED", kind: "FUNNEL_STAGE", ref: "checkout" });
    expect(checkout.impact.contributionProfit.state).toBe("ESTIMATED");
    expect(checkout.measurement.primaryMetric).toBe("cvr");
    expect(checkout.rollbackConditions.some((item) => item.kind === "HARD_CONSTRAINT_VIOLATION")).toBe(true);
    expect(checkout.consequences).toHaveLength(6);
  });

  it("blocks interventions that violate merchant constraints", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({
        signals: ["margin_compression"],
        constraints: [{
          constraintId: "margin-floor",
          kind: "MARGIN_FLOOR",
          status: "VIOLATED",
          metricId: "gross_margin",
          comparator: "GTE",
          threshold: 0.4,
          observedValue: 0.3,
          unit: "RATIO",
          evidenceMetricIds: ["gross_margin"],
          reason: "Projected margin is below the merchant floor.",
        }],
      }),
      supportedActionTypes: ["promotion.modify"],
    });
    const promotion = result.opportunities.find((item) => item.intervention.templateId === "promotion.reduce_discount")!;
    expect(promotion.feasibility.status).toBe("BLOCKED");
    expect(promotion.constraints.some((item) => item.status === "VIOLATED")).toBe(true);
  });

  it("requires conversion remediation before paid scaling when conversion has declined", () => {
    const result = generateOpportunities({ snapshot: makeSnapshot(), diagnosis });
    const checkout = result.opportunities.find((item) => item.intervention.templateId === "cro.checkout_fix")!;
    const paidScale = result.opportunities.find((item) => item.intervention.templateId === "paid.scale_incremental")!;
    expect(paidScale.prioritization.dependencies).toContain(checkout.opportunityId);
    const isolated = buildOpportunityPortfolio("paid-alone", [paidScale]);
    expect(isolated.status).toBe("BLOCKED");
    expect(isolated.dependencyIssues.length).toBeGreaterThan(0);
  });

  it("represents mutually exclusive alternatives and portfolio combinations deterministically", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["margin_compression"] }),
    });
    const alternatives = result.opportunities.filter((item) => item.areaId === "area_margin_compression");
    expect(alternatives.length).toBeGreaterThanOrEqual(3);
    const portfolio = buildOpportunityPortfolio("alternatives", alternatives.slice(0, 2));
    expect(portfolio.status).toBe("BLOCKED");
    expect(portfolio.conflictIssues.length).toBeGreaterThan(0);
    const portfolios = generateOpportunityPortfolios(result.opportunities, { maxSize: 2 });
    expect(portfolios.some((item) => item.portfolioId === "portfolio_no_action")).toBe(true);
  });

  it("does not cross the simulator boundary before canonical Action binding", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot(),
      diagnosis,
      supportedActionTypes: ["cro.modify_checkout"],
      candidateHints: [{ templateId: "cro.checkout_fix", parameters: { change_ref: "checkout-v2" } }],
      estimateEvidence: [causalCheckoutEvidence],
    });
    const checkout = result.opportunities.find((item) => item.intervention.templateId === "cro.checkout_fix")!;
    expect(compileOpportunityToSimulator(checkout, {})).toMatchObject({
      status: "BLOCKED",
      code: "CANONICAL_ACTION_REQUIRED",
    });
  });
});
