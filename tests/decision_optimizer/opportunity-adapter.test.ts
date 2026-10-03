import { describe, expect, it } from "vitest";
import { generateOpportunities } from "../../src/opportunity_engine/generator.js";
import { optimizeOpportunities, type CanonicalTwinGateway } from "../../src/decision_optimizer/opportunity-adapter.js";
import { DEFAULT_SEARCH_POLICY, type OptimizationInput } from "../../src/decision_optimizer/types.js";
import { objectiveFromIntent } from "../../src/decision_optimizer/math.js";
import { causalCheckoutEvidence, makeSnapshot } from "../opportunity_engine/fixture.js";

function request(): Omit<OptimizationInput, "options"> {
  return { decisionId: "decision_adapter", context: {
    merchantId: "merchant-1", snapshotId: "snapshot-opportunity-test", currency: "CAD", moneyUnit: "MAJOR", asOf: "2026-10-01T00:00:00.000Z", timeZone: "UTC",
    dayBoundaries: ["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"],
  }, objective: objectiveFromIntent("maximize contribution profit"), resources: [], metricConstraints: [], policy: { ...DEFAULT_SEARCH_POLICY } };
}
const baseline = { netRevenue: 1000, costOfGoods: 300, fulfillmentCost: 50, paidMediaCost: 100, otherVariableCost: 20, interventionCost: 0 };
const statusQuoTwin: CanonicalTwinGateway = {
  predict(input) {
    expect(input.canonicalCandidates).toEqual([{ candidateId: "candidate:none", actions: [] }]);
    return { modelVersion: "synthetic-adapter-fixture", context: input.context, calibrationEvidenceRefs: ["evidence_fixture"], evidenceRefs: ["evidence_fixture"], assumptions: ["Synthetic integration fixture"],
      baseline: [{ scenarioId: "scenario_a", probability: 0.5, metrics: baseline }, { scenarioId: "scenario_b", probability: 0.5, metrics: baseline }], forecasts: [] };
  },
};
const unusedCompatibility = (): never => { throw new Error("No action portfolio should reach this callback"); };
describe("Opportunity-to-optimizer integration", () => {
  it("consumes the real generated OpportunitySet without inventing executable Actions", async () => {
    const set = generateOpportunities({ snapshot: makeSnapshot() });
    const result = await optimizeOpportunities(set, request(), [], unusedCompatibility, statusQuoTwin);
    expect(result.decision.status).toBe("HOLD");
    expect(result.decision.input.options).toHaveLength(0);
    expect(result.skippedOpportunities.length).toBe(set.opportunities.length);
  });
  it("rejects merchant or as-of substitution before calling the Twin", async () => {
    const set = generateOpportunities({ snapshot: makeSnapshot() });
    for (const change of [{ merchantId: "other-merchant" }, { asOf: "2026-10-02T00:00:00.000Z" }]) {
      const input = request(); Object.assign(input.context, change);
      await expect(optimizeOpportunities(set, input, [], unusedCompatibility, statusQuoTwin)).rejects.toThrow("mismatch");
    }
  });
  it("does not optimize from an incomplete source evidence set", async () => {
    const set = generateOpportunities({ snapshot: makeSnapshot({ evidenceComplete: false }) });
    await expect(optimizeOpportunities(set, request(), [], unusedCompatibility, statusQuoTwin)).rejects.toThrow("INCOMPLETE_OPPORTUNITY_EVIDENCE");
  });
  it("actionable estimates without canonical Actions are blocked, not converted into forecasts", async () => {
    const set = generateOpportunities({ snapshot: makeSnapshot(), diagnosis: { merchantId: "merchant-1", changes: [{ id: "change:cvr", metricId: "cvr", status: "material", delta: -0.02, evidenceIds: ["diag.cvr"] }], unknowns: [] },
      supportedActionTypes: ["cro.modify_checkout"], candidateHints: [{ templateId: "cro.checkout_fix", parameters: { change_ref: "checkout-v2" }, requiredResources: ["engineering.checkout"] }], estimateEvidence: [causalCheckoutEvidence] });
    expect(set.opportunities.some(item => item.status === "ACTIONABLE")).toBe(true);
    await expect(optimizeOpportunities(set, request(), [], unusedCompatibility, statusQuoTwin)).rejects.toThrow("CANONICAL_BINDING_REQUIRED");
  });
  it("rejects hidden evaluator data before parsing the OpportunitySet", async () => {
    const set = generateOpportunities({ snapshot: makeSnapshot() });
    await expect(optimizeOpportunities({ ...set, oracleAnswer: "scale" }, request(), [], unusedCompatibility, statusQuoTwin)).rejects.toThrow("evaluator");
  });
});
