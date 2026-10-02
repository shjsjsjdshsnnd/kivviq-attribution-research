import { describe, expect, it } from "vitest";
import { OpportunitySafetyError } from "../../src/opportunity_engine/operator-safety.js";
import { estimateOpportunityImpact } from "../../src/opportunity_engine/estimation.js";
import { availableOpportunityTemplates, generateOpportunities } from "../../src/opportunity_engine/generator.js";
import { makeSnapshot } from "./fixture.js";

describe("Opportunity Engine adversarial behavior", () => {
  it("rejects hidden oracle and ground-truth information", () => {
    expect(() => generateOpportunities({
      snapshot: makeSnapshot(),
      diagnosis: { merchantId: "merchant-1", changes: [], unknowns: [], oracleAnswer: "scale-meta" },
    })).toThrow(OpportunitySafetyError);
  });

  it("treats a retargeting/ROAS trap as reallocation plus investigation, not blind budget scaling", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["retargeting_heavy", "platform_roas_high_incrementality_unmeasured"] }),
    });
    const types = new Set(result.opportunities.map((item) => item.intervention.actionType));
    expect(types.has("advertising.set_allocation")).toBe(true);
    expect(types.has("investigation.inspect")).toBe(true);
    expect(types.has("advertising.adjust_budget")).toBe(false);
  });

  it("treats high platform ROAS without incrementality as an investigation, not a scale instruction", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["platform_roas_high_incrementality_unmeasured"] }),
    });
    const area = result.opportunities.filter((item) => item.areaId === "area_platform_roas_unverified");
    expect(area.length).toBeGreaterThan(0);
    expect(area.every((item) => item.domain === "INVESTIGATION")).toBe(true);
    expect(area.some((item) => item.intervention.actionType === "advertising.adjust_budget")).toBe(false);
  });

  it("does not convert inventory pressure into blind demand scaling", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["inventory_constrained"] }),
    });
    const area = result.opportunities.filter((item) => item.areaId === "area_inventory_constrained");
    expect(area.some((item) => item.intervention.actionType === "inventory.reorder")).toBe(true);
    expect(area.some((item) => item.intervention.actionType === "inventory.protect_inventory")).toBe(true);
    expect(area.some((item) => item.intervention.actionType === "advertising.adjust_budget")).toBe(false);
  });

  it("creates non-discount alternatives when discounting and margin compression are present", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["discount_driven_growth", "margin_compression"] }),
    });
    const types = new Set(result.opportunities.map((item) => item.intervention.actionType));
    expect(types.has("promotion.modify")).toBe(true);
    expect(types.has("pricing.adjust_price")).toBe(true);
    expect(types.has("merchandising.feature")).toBe(true);
  });

  it("fails closed when business-state evidence is incomplete", () => {
    const result = generateOpportunities({ snapshot: makeSnapshot({ evidenceComplete: false }) });
    expect(result.evidenceComplete).toBe(false);
    expect(result.opportunities.some((item) => item.intervention.actionType === "investigation.inspect")).toBe(true);
    expect(result.opportunities.find((item) => item.status === "NO_ACTION")?.intervention.actionType).toBe("no_op.wait_observe");
  });

  it("retains negative cannibalization evidence instead of counting it as incremental upside", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["retargeting_heavy"] }),
      supportedActionTypes: ["advertising.set_allocation"],
      candidateHints: [{
        templateId: "paid.reallocate_prospecting",
        target: { kind: "CHANNEL", ref: "meta" },
        parameters: { prospecting_share_basis_points: 7000 },
      }],
      estimateEvidence: [{
        templateId: "paid.reallocate_prospecting",
        incrementalEffect: {
          metric: "incremental_revenue",
          unit: "MONEY",
          low: 2000,
          base: 4000,
          high: 6000,
          evidenceRefs: ["experiment.meta"],
          method: "EXPERIMENT",
        },
        contributionMarginRate: 0.3,
        consequences: [{
          dimension: "CANNIBALIZATION",
          direction: "NEGATIVE",
          impact: {
            metric: "contribution_profit",
            unit: "MONEY",
            low: -2500,
            base: -1500,
            high: -500,
            evidenceRefs: ["experiment.meta.cannibalization"],
            method: "EXPERIMENT",
          },
          notes: ["Observed substitution against demand that would otherwise convert."],
        }],
      }],
    });
    const candidate = result.opportunities.find((item) => item.intervention.templateId === "paid.reallocate_prospecting")!;
    const cannibalization = candidate.consequences.find((item) => item.dimension === "CANNIBALIZATION")!;
    expect(cannibalization.state).toBe("ESTIMATED");
    expect(cannibalization.direction).toBe("NEGATIVE");
    expect(cannibalization.impact?.state).toBe("ESTIMATED");
  });

  it("preserves delayed time-to-impact evidence for the Decision Engine", () => {
    const result = generateOpportunities({
      snapshot: makeSnapshot({ signals: ["retention_weak"] }),
      supportedActionTypes: ["lifecycle.start_flow"],
      candidateHints: [{
        templateId: "lifecycle.winback",
        target: { kind: "CUSTOMER_SEGMENT", ref: "lapsed-90d" },
        parameters: { flow_ref: "winback-v1" },
      }],
      estimateEvidence: [{
        templateId: "lifecycle.winback",
        incrementalEffect: {
          metric: "contribution_profit",
          unit: "MONEY",
          low: 1000,
          base: 2500,
          high: 4500,
          evidenceRefs: ["experiment.winback"],
          method: "EXPERIMENT",
        },
        timeToImpactDays: {
          low: 14,
          base: 30,
          high: 60,
          evidenceRefs: ["history.winback-lag"],
        },
      }],
    });
    const candidate = result.opportunities.find((item) => item.intervention.templateId === "lifecycle.winback")!;
    expect(candidate.prioritization.timeToImpact.state).toBe("ESTIMATED");
    if (candidate.prioritization.timeToImpact.state === "ESTIMATED") {
      expect(candidate.prioritization.timeToImpact.base).toBe(30);
    }
  });

  it("rejects platform attribution as a causal incremental-effect method", () => {
    expect(() => generateOpportunities({
      snapshot: makeSnapshot({ signals: ["retargeting_heavy"] }),
      estimateEvidence: [{
        templateId: "paid.reallocate_prospecting",
        incrementalEffect: {
          metric: "incremental_revenue",
          unit: "MONEY",
          low: 1000,
          base: 2000,
          high: 3000,
          evidenceRefs: ["platform.meta"],
          method: "PLATFORM_ATTRIBUTION",
        },
      } as any],
    })).toThrow();
  });

  it("supports nonlinear response curves without assuming linear scaling", () => {
    const template = availableOpportunityTemplates().find((item) => item.templateId === "paid.scale_incremental")!;
    const impact = estimateOpportunityImpact(template, makeSnapshot(), {
      templateId: "paid.scale_incremental",
      responseCurve: {
        state: "ESTIMATED",
        inputMetric: "budget_delta_minor",
        outputMetric: "incremental_revenue",
        points: [
          { input: 0, output: 0 },
          { input: 1000, output: 5000 },
          { input: 5000, output: 9000 },
        ],
        evidenceRefs: ["experiment.spend_curve"],
        method: "EXPERIMENT",
      },
      requestedInput: 3000,
      responseUncertaintyRatio: 0.2,
      contributionMarginRate: 0.3,
    });
    expect(impact.incrementalRevenue.state).toBe("ESTIMATED");
    if (impact.incrementalRevenue.state === "ESTIMATED") {
      expect(impact.incrementalRevenue.base).toBe(7000);
      expect(impact.incrementalRevenue.high - impact.incrementalRevenue.base).toBeGreaterThan(0);
    }

    const saturated = estimateOpportunityImpact(template, makeSnapshot(), {
      templateId: "paid.scale_incremental",
      responseCurve: {
        state: "ESTIMATED",
        inputMetric: "budget_delta_minor",
        outputMetric: "incremental_revenue",
        points: [
          { input: 0, output: 0 },
          { input: 1000, output: 5000 },
          { input: 5000, output: 9000 },
        ],
        evidenceRefs: ["experiment.spend_curve"],
        method: "EXPERIMENT",
      },
      requestedInput: 20000,
      responseUncertaintyRatio: 0.2,
      contributionMarginRate: 0.3,
    });
    if (saturated.incrementalRevenue.state === "ESTIMATED") {
      expect(saturated.incrementalRevenue.base).toBe(9000);
    }
  });
});
