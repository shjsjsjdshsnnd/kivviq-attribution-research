import { describe, expect, it } from "vitest";
import {
  defaultRetentionLtvScenario,
} from "../../src/retention_ltv/runtime.js";
import {
  FIX_CHECKOUT_DEFECT,
  poorCheckoutScenario,
} from "../../src/website_cro/adversarial.js";
import {
  replayCroIntervention,
} from "../../src/website_cro/evaluator.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const AS_OF = "2026-04-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";

describe("Step 12 CRO future-value replay", () => {
  it(
    "reports same-seed oracle future realized contribution after an explicit cutoff",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64501),
      );
      const population = populationFor(
        world,
        7351,
        100,
      );
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 151,
        startTime: START,
        endTime: END,
        futureValueAsOf: AS_OF,
        websiteScenario:
          poorCheckoutScenario(START),
        intervention: FIX_CHECKOUT_DEFECT,
        commercePolicy: {
          retentionScenario:
            defaultRetentionLtvScenario(world),
        },
        config: {
          maxEvents: 220_000,
          maxSessionsPerCustomer: 28,
          opportunityCadenceHours: 72,
        },
      });

      expect(
        replay.delta
          .oracleFutureRealizedContributionMinor,
      ).not.toBeNull();
      expect(
        replay.delta
          .oracleFutureRealizedContributionMinor!,
      ).toBeGreaterThan(0);
      expect(
        replay.counterfactual.provenance.simulationSeed,
      ).toBe(replay.factual.provenance.simulationSeed);
      expect(
        replay.counterfactual.provenance.merchantWorldId,
      ).toBe(replay.factual.provenance.merchantWorldId);
    },
    60_000,
  );

  it("rejects a future-value cutoff outside the replay horizon", () => {
    const world = baseAdversarialWorld(64502);
    const population = populationFor(
      world,
      7352,
      12,
    );

    expect(() =>
      replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 152,
        startTime: START,
        endTime: END,
        futureValueAsOf: START,
        websiteScenario:
          poorCheckoutScenario(START),
        intervention: FIX_CHECKOUT_DEFECT,
      }),
    ).toThrow(
      "futureValueAsOf must satisfy startTime < futureValueAsOf < endTime",
    );
  });
});
