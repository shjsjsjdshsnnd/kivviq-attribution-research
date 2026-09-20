import { describe, expect, it } from "vitest";
import {
  evaluateZeroPaidEffectAcceptance,
  observationalTouchCohort,
  promotionSelectionSummary,
} from "../../src/simulation/evaluator.js";
import {
  replayPaidMediaOff,
} from "../../src/simulation/counterfactual.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import type { SimulationResult } from "../../src/simulation/types.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
  withChannelEffects,
} from "./fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-10-01T00:00:00.000Z";

function truthForPath(
  result: SimulationResult,
  path: string,
  required: readonly string[],
  forbidden: readonly string[],
) {
  return result.godMode.purchaseTruth.find((truth) => {
    if (truth.observablePath.join(" -> ") !== path) return false;
    const causal = new Set(truth.causalChannels);
    return (
      required.every((channel) => causal.has(channel as never)) &&
      forbidden.every((channel) => !causal.has(channel as never))
    );
  });
}

describe("Step 4 causal adversarial acceptance", () => {
  it(
    "keeps true incremental paid revenue exactly zero while observational metrics can look effective",
    () => {
      const base = baseAdversarialWorld(63001);
      const world = allPaidEffectsZero(base);
      const population = populationFor(world, 7201, 220);

      let accepted:
        | ReturnType<typeof evaluateZeroPaidEffectAcceptance>
        | undefined;
      let factual: SimulationResult | undefined;

      for (let seed = 1; seed <= 8; seed += 1) {
        const replay = replayPaidMediaOff({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 300_000 },
        });

        const evaluation = evaluateZeroPaidEffectAcceptance(
          replay,
          world.manifest.channelIncrementality,
        );

        expect(evaluation.paidMerchantEffectsAllZero).toBe(true);
        expect(evaluation.trueIncrementalPaidRevenueMinor).toBe(0);
        expect(replay.delta.representedOrders).toBe(0);
        expect(replay.delta.representedContributionProfitMinor).toBe(0);

        if (
          evaluation.observedPaidAttributedRevenueMinor > 0 &&
          evaluation.paidChannelsLookingEffective.length > 0 &&
          evaluation.realisticPaidTouchedPurchasePaths.length > 0
        ) {
          accepted = evaluation;
          factual = replay.factual;
          break;
        }
      }

      expect(accepted).toBeDefined();
      expect(accepted!.observedPaidAttributedRevenueMinor).toBeGreaterThan(0);
      expect(accepted!.paidChannelsLookingEffective.length).toBeGreaterThan(0);
      expect(
        accepted!.realisticPaidTouchedPurchasePaths.some(
          (path) =>
            path.includes("google_search") ||
            path.includes("meta") ||
            path.includes("pinterest"),
        ),
      ).toBe(true);

      const candidateChannels = ["google_search", "meta", "email"] as const;
      const misleadingCohorts = candidateChannels
        .filter((channel) =>
          world.summary.activeChannels.includes(channel),
        )
        .map((channel) =>
          observationalTouchCohort(
            factual!,
            population,
            channel,
          ),
        )
        .filter(
          (cohort) =>
            cohort.touchedRepresentedCustomers > 0 &&
            cohort.untouchedRepresentedCustomers > 0 &&
            (cohort.touchedPurchaseRate >
              cohort.untouchedPurchaseRate ||
              cohort.touchedRevenuePerCustomerMinor >
                cohort.untouchedRevenuePerCustomerMinor ||
              cohort.touchedRepeatBuyerRate >
                cohort.untouchedRepeatBuyerRate),
        );

      expect(misleadingCohorts.length).toBeGreaterThan(0);
    },
    90_000,
  );

  it(
    "shows promotion selection among realized buyers",
    () => {
      const world = allPaidEffectsZero(baseAdversarialWorld(63002));
      const population = populationFor(world, 7202, 220);

      let summary: ReturnType<typeof promotionSelectionSummary> | undefined;
      for (let seed = 10; seed < 18; seed += 1) {
        const result = simulateWorld({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 300_000 },
        });
        const candidate = promotionSelectionSummary(result, population);
        if (
          candidate.discountedBuyerCount > 3 &&
          candidate.fullPriceBuyerCount > 3
        ) {
          summary = candidate;
          break;
        }
      }

      expect(summary).toBeDefined();
      expect(summary!.discountedBuyerCount).toBeGreaterThan(0);
      expect(summary!.fullPriceBuyerCount).toBeGreaterThan(0);
      expect(
        summary!.discountedBuyerMeanPromotionSensitivity,
      ).toBeGreaterThan(
        summary!.fullPriceBuyerMeanPromotionSensitivity,
      );
    },
    90_000,
  );

  it(
    "supports identical-looking Meta → Google → purchase paths with four different causal truths",
    () => {
      const zeroBase = allPaidEffectsZero(baseAdversarialWorld(63003));
      const population = populationFor(zeroBase, 7203, 260);
      const scale =
        zeroBase.summary.expectedAnnualOrders / 12;

      const worlds = {
        metaOnly: withChannelEffects(
          zeroBase,
          {
            meta: scale * 0.16,
            google_search: 0,
          },
          { zeroInteractions: true },
        ),
        googleOnly: withChannelEffects(
          zeroBase,
          {
            meta: 0,
            google_search: scale * 0.16,
          },
          { zeroInteractions: true },
        ),
        both: withChannelEffects(
          zeroBase,
          {
            meta: scale * 0.12,
            google_search: scale * 0.12,
          },
          { zeroInteractions: true },
        ),
        neither: zeroBase,
      };

      let demonstration:
        | {
            readonly path: string;
            readonly results: Record<string, SimulationResult>;
          }
        | undefined;

      for (let seed = 40; seed < 52; seed += 1) {
        const results = Object.fromEntries(
          Object.entries(worlds).map(([key, world]) => [
            key,
            simulateWorld({
              merchantWorld: world,
              latentPopulation: population,
              simulationSeed: seed,
              startTime: START,
              endTime: END,
              config: { maxEvents: 340_000 },
            }),
          ]),
        ) as Record<string, SimulationResult>;

        const paths = new Set(
          results.neither.godMode.purchaseTruth
            .map((truth) => truth.observablePath.join(" -> "))
            .filter(
              (path) =>
                path.includes("meta") &&
                path.includes("google_search"),
            ),
        );

        for (const path of paths) {
          const a = truthForPath(
            results.metaOnly,
            path,
            ["meta"],
            ["google_search"],
          );
          const b = truthForPath(
            results.googleOnly,
            path,
            ["google_search"],
            ["meta"],
          );
          const c = truthForPath(
            results.both,
            path,
            ["meta", "google_search"],
            [],
          );
          const d = truthForPath(
            results.neither,
            path,
            [],
            ["meta", "google_search"],
          );

          if (a && b && c && d) {
            demonstration = { path, results };
            break;
          }
        }
        if (demonstration) break;
      }

      expect(demonstration).toBeDefined();
      expect(demonstration!.path).toContain("meta");
      expect(demonstration!.path).toContain("google_search");
    },
    120_000,
  );

  it(
    "recovers nonzero incremental effects when causal mechanisms are re-enabled",
    () => {
      const zeroBase = allPaidEffectsZero(baseAdversarialWorld(63004));
      const population = populationFor(zeroBase, 7204, 220);
      const scale =
        zeroBase.summary.expectedAnnualOrders / 12;
      const causalWorld = withChannelEffects(
        zeroBase,
        {
          meta: scale * 0.3,
          google_search: scale * 0.24,
          pinterest: scale * 0.18,
        },
        { zeroInteractions: true },
      );

      let positiveDelta = 0;
      for (let seed = 70; seed < 76; seed += 1) {
        const replay = replayPaidMediaOff({
          merchantWorld: causalWorld,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 320_000 },
        });
        positiveDelta += replay.delta.representedRevenueMinor;
      }

      expect(positiveDelta).toBeGreaterThan(0);
    },
    120_000,
  );
});
