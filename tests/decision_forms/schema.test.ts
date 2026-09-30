import { describe, expect, it } from "vitest";
import { decisionWhatSchema } from "../../src/decision_forms/index.js";
const duration = {
  kind: "CALENDAR",
  amount: 2,
  unit: "DAY",
  anchor: "REQUESTED_START",
};
export const investigation = {
  actionType: "investigation.inspect",
  category: { kind: "MISSING_DATA_REQUEST" },
  targets: [{ kind: "SKU", ref: "sku-a" }],
  requiredEvidence: [
    {
      evidenceId: "cogs",
      reference: { kind: "FACT", ref: "unit_cogs" },
      targetRef: "sku-a",
    },
  ],
  successCriteria: [
    { kind: "EVIDENCE_COVERAGE", evidenceIds: ["cogs"], minimumCoverage: 1 },
  ],
  observationWindow: {
    start: "2026-08-27T00:00:00Z",
    end: "2026-09-25T00:00:00Z",
  },
  expectedDuration: duration,
  maximumInvestigationHorizon: duration,
  costs: {
    analyst: { state: "UNKNOWN" },
    engineering: { state: "KNOWN", amountMinor: 0, currency: "USD" },
    externalService: { state: "UNKNOWN" },
  },
  requiredResources: [{ kind: "MERCHANT_EFFORT", quantity: 1, unit: "HOUR" }],
};
describe("structured decision forms", () => {
  it("represents deliberate preservation, observation and information separately", () => {
    expect(
      decisionWhatSchema.safeParse({
        actionType: "no_op.do_nothing",
        scope: { kind: "GLOBAL" },
      }).success,
    ).toBe(true);
    expect(
      decisionWhatSchema.safeParse({
        actionType: "no_op.wait_observe",
        scope: { kind: "CHANNEL", ref: "google" },
        reassessment: { kind: "AFTER_OBSERVATION", duration },
      }).success,
    ).toBe(true);
    expect(decisionWhatSchema.safeParse(investigation).success).toBe(true);
  });
  it("rejects findings, outcome leakage and PII at every nested boundary", () => {
    for (const key of [
      "finding",
      "cause",
      "expectedRevenue",
      "expectedProfit",
      "expectedROAS",
      "expectedLift",
      "expectedSynergy",
      "expectedValueOfInformation",
      "predictedBestAction",
      "predictedInvestigationValue",
      "recommendationScore",
      "confidenceScore",
      "bestCandidate",
      "email",
    ]) {
      expect(
        decisionWhatSchema.safeParse({ ...investigation, [key]: "leak" })
          .success,
        key,
      ).toBe(false);
      expect(
        decisionWhatSchema.safeParse({
          ...investigation,
          targets: [{ kind: "SKU", ref: "sku-a", [key]: "leak" }],
        }).success,
        key,
      ).toBe(false);
    }
  });
  it("rejects unstructured criteria, undefined evidence and invalid windows", () => {
    expect(
      decisionWhatSchema.safeParse({
        ...investigation,
        successCriteria: ["get more data"],
      }).success,
    ).toBe(false);
    expect(
      decisionWhatSchema.safeParse({
        ...investigation,
        successCriteria: [
          {
            kind: "EVIDENCE_COVERAGE",
            evidenceIds: ["missing"],
            minimumCoverage: 1,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      decisionWhatSchema.safeParse({
        ...investigation,
        observationWindow: {
          start: "2026-09-27T00:00:00Z",
          end: "2026-09-25T00:00:00Z",
        },
      }).success,
    ).toBe(false);
  });
});
