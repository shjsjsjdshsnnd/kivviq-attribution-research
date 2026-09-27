import { expect, it } from "vitest";
import { decisionWhatSchema } from "../../src/decision_forms/index.js";
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
import { validateInvestigationExecutionHorizon } from "../../src/decision_forms/timing.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { utcTimestamp } from "../../src/core/units.js";
import type { ActionTiming } from "../../src/action_timing/types.js";
const context = { approvedClock: utcTimestamp("2026-09-22T14:00:00Z") };
const what = investigationExamples.missingCogs;
const timing: ActionTiming = {
  ...immediatePersistentBudgetTiming,
  duration: {
    state: "SPECIFIED",
    value: {
      kind: "CALENDAR",
      amount: 2,
      unit: "DAY",
      anchor: "REQUESTED_START",
    },
  },
};
it("requires population targets to point to the envelope marker", () => {
  const population = investigationExamples.customerConsent;
  expect(decisionWhatSchema.safeParse(population).success).toBe(true);
  expect(
    decisionWhatSchema.safeParse({
      ...population,
      targets: [{ kind: "POPULATION", ref: "population-another" }],
      requiredEvidence: population.requiredEvidence.map((e) => ({
        ...e,
        targetRef: "population-another",
      })),
    }).success,
  ).toBe(false);
});
it("compares finite execution with maximum without mutating the source", () => {
  const before = JSON.stringify(timing);
  expect(
    validateInvestigationExecutionHorizon(what, timing, context).status,
  ).toBe("VALID");
  expect(
    validateInvestigationExecutionHorizon(
      what,
      {
        ...timing,
        duration: {
          state: "SPECIFIED",
          value: {
            kind: "CALENDAR",
            amount: 3,
            unit: "DAY",
            anchor: "REQUESTED_START",
          },
        },
      },
      context,
    ).status,
  ).toBe("INVALID");
  expect(JSON.stringify(timing)).toBe(before);
});
it("cannot certify persistent or unknown execution duration", () => {
  expect(
    validateInvestigationExecutionHorizon(
      what,
      immediatePersistentBudgetTiming,
      context,
    ).status,
  ).toBe("INVALID");
  expect(
    validateInvestigationExecutionHorizon(
      what,
      { ...timing, duration: { state: "UNKNOWN", reason: "not supplied" } },
      context,
    ).status,
  ).toBe("UNRESOLVED");
});
it("preserves calendar arithmetic across daylight saving time", () => {
  const dst: ActionTiming = {
    ...timing,
    decisionTime: {
      state: "SPECIFIED",
      value: utcTimestamp("2026-03-07T17:00:00Z"),
    },
    duration: {
      state: "SPECIFIED",
      value: {
        kind: "ELAPSED",
        amount: 24,
        unit: "HOUR",
        anchor: "REQUESTED_START",
      },
    },
  };
  const oneDay = {
    ...what,
    expectedDuration: {
      kind: "CALENDAR" as const,
      amount: 1,
      unit: "DAY" as const,
      anchor: "REQUESTED_START" as const,
    },
    maximumInvestigationHorizon: {
      kind: "CALENDAR" as const,
      amount: 1,
      unit: "DAY" as const,
      anchor: "REQUESTED_START" as const,
    },
  };
  const result = validateInvestigationExecutionHorizon(oneDay, dst, {
    approvedClock: utcTimestamp("2026-03-07T17:00:00Z"),
  });
  expect(result.status).toBe("INVALID");
  expect(result.maximumEnd).toBe("2026-03-08T16:00:00.000Z");
});
