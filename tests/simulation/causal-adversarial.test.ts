import { describe, expect, it } from "vitest";
import {
  causalChannelsForSameObservablePurchase,
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

describe("Step 4 causal adversarial acceptance", () => {
  it(
    "keeps true incremental paid revenue exactly zero while observational metrics can look effective",
    () => {
      const base = baseAdversarialWorld(63001);
      const world = allPaidEffectsZero(base);
      const population = populationFor(world, 7201, 180);

      let accepted:
        | ReturnType<typeof evaluateZeroPaidEffectAcceptance>
        | undefined;
      let factual: SimulationResult | undefined;

      for (let seed = 1; seed <= 5; seed += 1) {
        const replay = replayPaidMediaOff({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 260_000 },
        });

        const evaluation = evaluateZeroPaidEffectAcceptance(
          replay,
          world.manifest.channelIncrementality,
        );

        expect(evaluation.paidMerchantEffectsAllZero).toBe(true);
        expect(evaluation.trueIncrementalPaidRevenueMinor).toBe(0);
        expect(replay.delta.representedOrders).toBe(0);

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
      const population = populationFor(world, 7202, 160);

      let summary: ReturnType<typeof promotionSelectionSummary> | undefined;
      for (let seed = 10; seed < 15; seed += 1) {
        const result = simulateWorld({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 240_000 },
        });
        const candidate = promotionSelectionSummary(result, population);
        if (
          candidate.discountedBuyerCount > 2 &&
          candidate.fullPriceBuyerCount > 2
        ) {
          summary = candidate;
          break;
        }
      }

      expect(summary).toBeDefined();
      expect(
        summary!.discountedBuyerMeanPromotionSensitivity,
      ).toBeGreaterThan(
        summary!.fullPriceBuyerMeanPromotionSensitivity,
      );
    },
    90_000,
  );

  it(
    "supports one identical Meta → Google → purchase path with four different hidden causal truths",
    () => {
      const world = allPaidEffectsZero(baseAdversarialWorld(63003));
      const population = populationFor(world, 7203, 180);

      let demonstration:
        | {
            readonly orderId: string;
            readonly path: string;
          }
        | undefined;

      for (let seed = 40; seed < 46; seed += 1) {
        const result = simulateWorld({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 260_000 },
        });

        const truth = result.godMode.purchaseTruth.find((candidate) => {
          const path = candidate.observablePath.join(" -> ");
          return path.includes("meta") && path.includes("google_search");
        });

        if (!truth) continue;

        demonstration = {
          orderId: truth.orderId,
          path: truth.observablePath.join(" -> "),
        };

        expect(
          causalChannelsForSameObservablePurchase(
            result,
            truth.orderId,
            { meta: 1, google_search: 0 },
          ),
        ).toEqual(["meta"]);

        expect(
          causalChannelsForSameObservablePurchase(
            result,
            truth.orderId,
            { meta: 0, google_search: 1 },
          ),
        ).toEqual(["google_search"]);

        expect(
          causalChannelsForSameObservablePurchase(
            result,
            truth.orderId,
            { meta: 1, google_search: 1 },
          ),
        ).toEqual(["google_search", "meta"]);

        expect(
          causalChannelsForSameObservablePurchase(
            result,
            truth.orderId,
            { meta: 0, google_search: 0 },
          ),
        ).toEqual([]);

        break;
      }

      expect(demonstration).toBeDefined();
      expect(demonstration!.path).toContain("meta");
      expect(demonstration!.path).toContain("google_search");
    },
    90_000,
  );

  it(
    "recovers nonzero incremental effects when causal mechanisms are re-enabled",
    () => {
      const zeroBase = allPaidEffectsZero(baseAdversarialWorld(63004));
      const population = populationFor(zeroBase, 7204, 170);
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
      for (let seed = 70; seed < 74; seed += 1) {
        const replay = replayPaidMediaOff({
          merchantWorld: causalWorld,
          latentPopulation: population,
          simulationSeed: seed,
          startTime: START,
          endTime: END,
          config: { maxEvents: 260_000 },
        });
        positiveDelta += replay.delta.representedRevenueMinor;
      }

      expect(positiveDelta).toBeGreaterThan(0);
    },
    90_000,
  );
});
