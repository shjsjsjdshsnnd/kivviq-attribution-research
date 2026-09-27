import { it, expect } from "vitest";
import { decisionWhatSchema } from "../../src/decision_forms/index.js";
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
it("compares elapsed durations across units", () => {
  const a = {
    ...investigationExamples.missingCogs,
    expectedDuration: {
      kind: "ELAPSED",
      amount: 120,
      unit: "MINUTE",
      anchor: "REQUESTED_START",
    },
    maximumInvestigationHorizon: {
      kind: "ELAPSED",
      amount: 1,
      unit: "HOUR",
      anchor: "REQUESTED_START",
    },
  };
  expect(decisionWhatSchema.safeParse(a).success).toBe(false);
});
