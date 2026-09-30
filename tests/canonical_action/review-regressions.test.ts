import { expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import {
  createPopulationFixtures,
  createPopulationSnapshot,
  evaluatePopulation,
  fingerprintPopulationDefinition,
  populationContextSchema,
} from "../../src/population/index.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";

it("does not substitute another frozen snapshot with identical definition and timestamp", () => {
  const fixture = createPopulationFixtures()[6]!;
  const first = createPopulationSnapshot(
    fixture.definition,
    fixture.evaluation,
    { snapshotId: "snapshot_first" },
  );
  const second = createPopulationSnapshot(
    fixture.definition,
    evaluatePopulation(fixture.definition, {
      ...fixture.context,
      customers: [],
    }),
    { snapshotId: "snapshot_second" },
  );
  const action = canonicalActionSchema.parse({
    ...createCanonicalFixtures()[0]!.action,
    population: {
      populationId: fixture.definition.populationId,
      version: fixture.definition.version,
      definitionFingerprint: fingerprintPopulationDefinition(
        fixture.definition,
      ),
      binding: "DECISION_TIME",
      membershipMode: "FROZEN_MEMBERSHIP",
      snapshotRef: first.snapshotId,
    },
  });
  expect(
    translateCanonicalAction(action, {
      timing: { approvedClock: "2026-09-26T12:00:00Z" },
      populations: [fixture.definition],
      snapshots: [second],
      bindingTimes: { DECISION_TIME: fixture.context.evaluatedAt },
    }).status,
  ).toBe("MISSING_CONTEXT");
});
it("rejects contradictory revenue summaries expressed with equivalent timestamp offsets", () => {
  const revenue = {
    currency: "CAD",
    window: { kind: "TRAILING_DAYS", days: 365 },
  };
  expect(
    populationContextSchema.safeParse({
      evaluatedAt: "2026-09-26T12:00:00Z",
      customers: [
        {
          customerId: "customer_a",
          revenues: [
            { ...revenue, amount: 600, asOf: "2026-09-26T12:00:00Z" },
            { ...revenue, amount: 100, asOf: "2026-09-26T12:00:00+00:00" },
          ],
        },
      ],
    }).success,
  ).toBe(false);
});
